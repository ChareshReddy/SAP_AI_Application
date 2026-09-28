using System;
using System.IO;
using System.Runtime.InteropServices;

public class DesktopRunner {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public Int32 cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public Int32 dwX;
        public Int32 dwY;
        public Int32 dwXSize;
        public Int32 dwYSize;
        public Int32 dwXCountChars;
        public Int32 dwYCountChars;
        public Int32 dwFillAttribute;
        public Int32 dwFlags;
        public Int16 wShowWindow;
        public Int16 cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern UInt32 WaitForSingleObject(IntPtr hHandle, UInt32 dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    public static string RunScript(string scriptPath, int timeoutMs) {
        string tempOut = Path.Combine(Path.GetTempPath(), "desk_out_" + Guid.NewGuid().ToString("N") + ".tmp");
        string tempCmd = Path.Combine(Path.GetTempPath(), "desk_cmd_" + Guid.NewGuid().ToString("N") + ".bat");

        File.WriteAllText(tempCmd, "@echo off\r\ncscript.exe //NoLogo \"" + scriptPath + "\" > \"" + tempOut + "\" 2>&1\r\n");

        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = "WinSta0\\Default";

        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
        string cmdLine = "cmd.exe /c \"" + tempCmd + "\"";

        bool ok = CreateProcess(null, cmdLine, IntPtr.Zero, IntPtr.Zero, false, 0x08000000 /* CREATE_NO_WINDOW */, IntPtr.Zero, null, ref si, out pi);
        if (!ok) {
            try { File.Delete(tempCmd); } catch {}
            return "ERROR: CreateProcess failed: " + Marshal.GetLastWin32Error();
        }

        WaitForSingleObject(pi.hProcess, (uint)timeoutMs);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);

        try { File.Delete(tempCmd); } catch {}

        string output = "";
        for (int retry = 0; retry < 15; retry++) {
            try {
                if (File.Exists(tempOut)) {
                    using (FileStream fs = new FileStream(tempOut, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                    using (StreamReader sr = new StreamReader(fs)) {
                        output = sr.ReadToEnd();
                    }
                    try { File.Delete(tempOut); } catch {}
                    break;
                }
            } catch (IOException) {
                System.Threading.Thread.Sleep(200);
            }
        }
        return output;
    }
}
