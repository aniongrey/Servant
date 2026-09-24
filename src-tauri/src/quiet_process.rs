//! Keeps helper processes from flashing a console window at the user.
//!
//! The app itself is a windowed binary (`windows_subsystem = "windows"` in
//! `main.rs`), but everything it launches is a console program: the backend
//! payload is a Node single-file executable built from `node.exe`, and
//! `taskkill` ships as one. Windows hands a console child of a windowless
//! parent a **brand new console** when no creation flag says otherwise — the
//! user sees a black window pop up in front of the app, and for the backend it
//! stays for as long as the process lives, which is the whole session.
//!
//! `CREATE_NO_WINDOW` creates that console detached: the child keeps its
//! standard handles and behaves identically, it simply owns no visible window.
//! Nothing is lost by hiding it — the backend already redirects stdout/stderr
//! into `backend.log` (`backend_server.rs`), and the `taskkill` calls discard
//! theirs.
//!
//! Route every external process through [`quiet`]; a bare `Command::new` on
//! Windows is a bug in a windowed build.

use std::process::Command;

/// `CREATE_NO_WINDOW` from `winbase.h`. Not a valid `Command` flag off Windows,
/// where the whole module degenerates to a no-op.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Marks `command` as owning no console window.
///
/// Takes and returns the command by value so it reads inline in the call chain:
/// `quiet(Command::new(payload)).env("A", "b").spawn()?`.
pub(crate) fn quiet(command: Command) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        let mut command = command;
        command.creation_flags(CREATE_NO_WINDOW);
        return command;
    }

    #[cfg(not(windows))]
    command
}
