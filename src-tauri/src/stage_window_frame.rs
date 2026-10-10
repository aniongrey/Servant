//! Keep the transparent pet window frameless both on stage and after returning to desktop mode.
use std::ffi::c_void;
use tauri::WebviewWindow;

type Hwnd = *mut c_void;
type SubclassProc = unsafe extern "system" fn(Hwnd, u32, usize, isize, usize, usize) -> isize;

#[link(name = "comctl32")]
extern "system" {
    fn SetWindowSubclass(hwnd: Hwnd, callback: SubclassProc, id: usize, data: usize) -> i32;
    fn RemoveWindowSubclass(hwnd: Hwnd, callback: SubclassProc, id: usize) -> i32;
    fn DefSubclassProc(hwnd: Hwnd, message: u32, wparam: usize, lparam: isize) -> isize;
}

const SUBCLASS_ID: usize = 0x5354_4746;
const WM_NCDESTROY: u32 = 0x0082;
const WM_NCCALCSIZE: u32 = 0x0083;
const WM_NCPAINT: u32 = 0x0085;
const WM_NCACTIVATE: u32 = 0x0086;

// Called by the synchronous stage command on the HWND-owning UI thread.
pub fn install(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as Hwnd;
    // The desktop pet is frameless too; keep this installed until WM_NCDESTROY.
    unsafe { install_inner(hwnd) }
}

#[link(name = "user32")]
extern "system" {
    fn GetWindowThreadProcessId(hwnd: Hwnd, process_id: *mut u32) -> u32;
}
#[link(name = "kernel32")]
extern "system" {
    fn GetCurrentThreadId() -> u32;
}

unsafe fn install_inner(hwnd: Hwnd) -> Result<(), String> {
    if GetWindowThreadProcessId(hwnd, std::ptr::null_mut()) != GetCurrentThreadId() {
        return Err("Stage frame changes must run on the window UI thread".into());
    }
    if SetWindowSubclass(hwnd, stage_frame_proc, SUBCLASS_ID, 0) == 0 {
        return Err("Failed to install the stage window frame handler".into());
    }
    Ok(())
}

unsafe extern "system" fn stage_frame_proc(
    hwnd: Hwnd,
    message: u32,
    wparam: usize,
    lparam: isize,
    id: usize,
    _data: usize,
) -> isize {
    match message {
        // Preserve Tao's activation/focus bookkeeping, but tell DefWindowProc not to paint a caption.
        WM_NCACTIVATE => DefSubclassProc(hwnd, message, wparam, -1),
        WM_NCCALCSIZE | WM_NCPAINT => 0,
        WM_NCDESTROY => {
            RemoveWindowSubclass(hwnd, stage_frame_proc, id);
            DefSubclassProc(hwnd, message, wparam, lparam)
        }
        _ => DefSubclassProc(hwnd, message, wparam, lparam),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[link(name = "user32")]
    extern "system" {
        fn CreateWindowExW(
            ex_style: u32,
            class: *const u16,
            title: *const u16,
            style: u32,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            parent: Hwnd,
            menu: Hwnd,
            instance: Hwnd,
            param: Hwnd,
        ) -> Hwnd;
        fn DestroyWindow(hwnd: Hwnd) -> i32;
        fn GetWindowLongPtrW(hwnd: Hwnd, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: Hwnd, index: i32, value: isize) -> isize;
        fn SetWindowPos(
            hwnd: Hwnd,
            after: Hwnd,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
        fn GetClientRect(hwnd: Hwnd, rect: *mut [i32; 4]) -> i32;
        fn SendMessageW(hwnd: Hwnd, message: u32, wparam: usize, lparam: isize) -> isize;
    }

    #[derive(Default)]
    struct Trace {
        activations: Vec<(usize, isize)>,
        paints: usize,
        calculations: usize,
        focus_messages: usize,
        close_messages: usize,
    }

    unsafe extern "system" fn observe(
        hwnd: Hwnd,
        message: u32,
        wparam: usize,
        lparam: isize,
        _id: usize,
        data: usize,
    ) -> isize {
        let trace = &mut *(data as *mut Trace);
        match message {
            WM_NCACTIVATE => trace.activations.push((wparam, lparam)),
            WM_NCPAINT => trace.paints += 1,
            WM_NCCALCSIZE => trace.calculations += 1,
            0x0007 | 0x0008 => trace.focus_messages += 1,
            0x0010 => {
                trace.close_messages += 1;
                return 0;
            }
            _ => {}
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }

    #[test]
    fn stage_blocks_native_frame_painting_without_swallowing_focus_and_detaches_cleanly() {
        unsafe {
            let class: Vec<u16> = "STATIC".encode_utf16().chain(Some(0)).collect();
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                0x00cf_0000,
                0,
                0,
                320,
                180,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            );
            assert!(!hwnd.is_null(), "test window creation failed");
            let mut trace = Trace::default();
            assert_ne!(
                SetWindowSubclass(hwnd, observe, 1, &mut trace as *mut Trace as usize),
                0
            );
            let other_thread_hwnd = hwnd as usize;
            let rejected = std::thread::spawn(move || install_inner(other_thread_hwnd as Hwnd))
                .join()
                .unwrap();
            assert!(
                rejected.is_err(),
                "cross-thread subclass changes must be rejected"
            );
            install_inner(hwnd).unwrap();
            install_inner(hwnd).unwrap(); // Re-entering stage must not stack handlers.
            SendMessageW(hwnd, WM_NCACTIVATE, 0, 0);
            SendMessageW(hwnd, WM_NCACTIVATE, 1, 0);
            SendMessageW(hwnd, WM_NCPAINT, 1, 0);
            SendMessageW(hwnd, WM_NCCALCSIZE, 0, 0);
            SendMessageW(hwnd, 0x0007, 0, 0);
            SendMessageW(hwnd, 0x0008, 0, 0);
            assert_eq!(trace.activations, vec![(0, -1), (1, -1)]);
            assert_eq!(trace.paints, 0);
            assert_eq!(trace.calculations, 0);
            assert_eq!(trace.focus_messages, 2);
            // Leaving fullscreen can restore WS_CAPTION; the pet must remain protected.
            let style = GetWindowLongPtrW(hwnd, -16);
            SetWindowLongPtrW(hwnd, -16, style | 0x00c0_0000);
            assert_ne!(
                SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    0,
                    0,
                    320,
                    180,
                    0x0002 | 0x0004 | 0x0010 | 0x0020
                ),
                0
            );
            SendMessageW(hwnd, WM_NCACTIVATE, 0, 0);
            SendMessageW(hwnd, WM_NCPAINT, 1, 0);
            assert_eq!(trace.activations.last(), Some(&(0, -1)));
            assert_eq!(trace.paints, 0);
            let mut client = [0; 4];
            assert_ne!(GetClientRect(hwnd, &mut client), 0);
            assert_eq!(client, [0, 0, 320, 180]);
            SendMessageW(hwnd, 0x0010, 0, 0);
            assert_eq!(
                trace.close_messages, 1,
                "native close must reach the application"
            );
            assert_ne!(RemoveWindowSubclass(hwnd, stage_frame_proc, SUBCLASS_ID), 0);
            SendMessageW(hwnd, WM_NCACTIVATE, 0, 0);
            assert_eq!(trace.activations.last(), Some(&(0, 0)));
            install_inner(hwnd).unwrap();
            assert_ne!(DestroyWindow(hwnd), 0); // WM_NCDESTROY removes the stage handler.
        }
    }
}
