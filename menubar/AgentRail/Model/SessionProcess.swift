import Foundation

/// Stops a session's agent process, once `ps` confirms it is still the one the collector saw:
/// the same pid, the same start time, and a `claude` or `codex` executable.
enum SessionProcess {
    static func isRunning(_ proc: SessionProc?) -> Bool {
        guard let proc, proc.pid > 1, !proc.start.isEmpty,
              let line = ps(["-o", "lstart=", "-o", "comm=", "-p", String(proc.pid)]) else { return false }
        // `lstart` is a fixed 24 characters ("Thu Oct 22 21:18:27 2026"), then the command path.
        let start = String(line.prefix(proc.start.count))
        let name = line.dropFirst(proc.start.count).trimmingCharacters(in: .whitespaces).split(separator: "/").last.map(String.init)
        return start == proc.start && (name == "claude" || name == "codex")
    }

    /// SIGTERM, as Ctrl+C's sibling: the CLI exits and its subagents with it.
    @discardableResult
    static func stop(_ proc: SessionProc) -> Bool {
        isRunning(proc) && kill(proc.pid, SIGTERM) == 0
    }

    private static func ps(_ args: [String]) -> String? {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/ps")
        task.arguments = args
        let out = Pipe()
        task.standardOutput = out
        task.standardError = FileHandle.nullDevice
        guard (try? task.run()) != nil else { return nil }
        task.waitUntilExit()
        let text = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return task.terminationStatus == 0 && !text.isEmpty ? text : nil
    }
}
