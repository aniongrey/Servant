//! Keep the transparent stage frameless during native focus changes.
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

pub async fn set_enabled(window: &WebviewWindow, enabled: bool) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as usize;
    let (send, receive) = tokio::sync::oneshot::channel();
    // Comctl32 subclass helpers must run on the thread that owns the HWND.
    window
        .run_on_main_thread(move || {
            let result = unsafe { set_enabled_inner(hwnd as Hwnd, enabled) };
            let _ = send.send(result);
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

unsafe fn set_enabled_inner(hwnd: Hwnd, enabled: bool) -> Result<(), String> {
    if enabled {
        if SetWindowSubclass(hwnd, stage_frame_proc, SUBCLASS_ID, 0) == 0 {
            return Err("Failed to install the stage window frame handler".into());
        }
    } else {
        // Removing an absent handler is harmless (the pet may never have entered stage mode).
        RemoveWindowSubclass(hwnd, stage_frame_proc, SUBCLASS_ID);
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
        fn SendMessageW(hwnd: Hwnd, message: u32, wparam: usize, lparam: isize) -> isize;
    }

    #[derive(Default)]
    struct Trace {
        activations: Vec<(usize, isize)>,
        paints: usize,
        calculations: usize,
        focus_messages: usize,
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
            set_enabled_inner(hwnd, true).unwrap();
            set_enabled_inner(hwnd, true).unwrap(); // Re-entering stage must not stack handlers.
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
            set_enabled_inner(hwnd, false).unwrap();
            SendMessageW(hwnd, WM_NCACTIVATE, 0, 0);
            assert_eq!(trace.activations.last(), Some(&(0, 0)));
            set_enabled_inner(hwnd, true).unwrap();
            assert_ne!(DestroyWindow(hwnd), 0); // WM_NCDESTROY removes the stage handler.
        }
    }
}
