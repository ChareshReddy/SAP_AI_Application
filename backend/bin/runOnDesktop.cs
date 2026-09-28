using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace SapLauncher {
    class Program {
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
        public static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

        static int Main(string[] args) {
            if (args.Length == 0) {
                Console.Error.WriteLine("Usage: runOnDesktop.exe <commandline>");
                return 1;
            }

            string fullCmd = string.Join(" ", args);
            string tempOut = Path.Combine(Path.GetTempPath(), "rod_out_" + Guid.NewGuid().ToString("N") + ".tmp");
            string batchFile = Path.Combine(Path.GetTempPath(), "rod_run_" + Guid.NewGuid().ToString("N") + ".bat");

            try {
                File.WriteAllText(batchFile, "@echo off\r\n" + fullCmd + " > \"" + tempOut + "\" 2>&1\r\n");

                STARTUPINFO si = new STARTUPINFO();
                si.cb = Marshal.SizeOf(si);
                si.lpDesktop = @"WinSta0\Default";

                PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
                string cmdLine = "cmd.exe /c \"" + batchFile + "\"";

                bool ok = CreateProcess(null, cmdLine, IntPtr.Zero, IntPtr.Zero, false, 0x08000000 /* CREATE_NO_WINDOW */, IntPtr.Zero, null, ref si, out pi);
                if (!ok) {
                    int err = Marshal.GetLastWin32Error();
                    Console.Error.WriteLine("CreateProcess failed: " + err);
                    return err;
                }

                WaitForSingleObject(pi.hProcess, 60000);
                uint exitCode = 0;
                GetExitCodeProcess(pi.hProcess, out exitCode);
                CloseHandle(pi.hProcess);
                CloseHandle(pi.hThread);

                if (File.Exists(tempOut)) {
                    string output = File.ReadAllText(tempOut);
                    Console.Write(output);
                }

                return (int)exitCode;
            } finally {
                try { if (File.Exists(batchFile)) File.Delete(batchFile); } catch {}
                try { if (File.Exists(tempOut)) File.Delete(tempOut); } catch {}
            }
        }
    }
}
