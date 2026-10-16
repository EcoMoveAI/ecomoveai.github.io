# Generates the PWA icons in public/icons from the same Ionicons "leaf" glyph and brand green used in the app.
# Windows PowerShell 5.1 (System.Drawing). Re-run only if the branding changes; the PNGs are committed.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$font = Join-Path $root 'node_modules\@expo\vector-icons\build\vendor\react-native-vector-icons\Fonts\Ionicons.ttf'
$out = Join-Path $root 'public\icons'
New-Item -ItemType Directory -Force $out | Out-Null

$pfc = New-Object System.Drawing.Text.PrivateFontCollection
$pfc.AddFontFile($font)
$family = $pfc.Families[0]
$glyph = [char]62386 # Ionicons "leaf"
$green = [System.Drawing.ColorTranslator]::FromHtml('#1F7A4D')

function New-Icon([int]$size, [double]$glyphScale, [string]$file, [bool]$rounded) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush $green
  if ($rounded) {
    $r = [int]($size * 0.22)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90)
    $path.AddArc($size - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
    $path.AddArc($size - 2 * $r, $size - 2 * $r, 2 * $r, 2 * $r, 0, 90)
    $path.AddArc(0, $size - 2 * $r, 2 * $r, 2 * $r, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
  } else {
    $g.FillRectangle($brush, 0, 0, $size, $size)
  }
  $em = [single]($size * $glyphScale)
  $f = New-Object System.Drawing.Font $family, $em, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'
  $fmt.LineAlignment = 'Center'
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $g.DrawString([string]$glyph, $f, [System.Drawing.Brushes]::White, $rect, $fmt)
  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-Icon 192 0.62 'icon-192.png' $true
New-Icon 512 0.62 'icon-512.png' $true
# Maskable: full-bleed background, glyph inside the 80% safe zone.
New-Icon 512 0.46 'maskable-512.png' $false
# iOS applies its own rounding.
New-Icon 180 0.58 'apple-touch-icon.png' $false
New-Icon 48 0.66 'favicon-48.png' $true
Write-Output "Icons written to $out"
