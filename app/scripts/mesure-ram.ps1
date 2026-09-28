# Mesure la RAM réelle d'On lance ? : le processus de l'app ET tous ses
# descendants (WebView2 crée plusieurs processus). C'est ce chiffre qu'on
# publie, pas celui du seul exécutable.
#
#   powershell -File app/scripts/mesure-ram.ps1                    # app déjà lancée
#   powershell -File app/scripts/mesure-ram.ps1 -Lancer <exe> -Attente 40
#
# Avec -Lancer : ferme l'app si elle tourne, la relance, laisse l'interface se
# stabiliser, puis relève la mémoire toutes les 5 s (3 relevés).

param(
  [string]$Lancer = '',
  [int]$Attente = 30
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Mesurer {
  $racine = Get-Process -Name onlance -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $racine) { return $null }
  $tous = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine
  # WebView2 range ses processus dans un dossier de données propre à l'app :
  # c'est le repère fiable (un processus WebView2 peut survivre à l'app qui
  # l'a lancé, et être repris par l'instance suivante sans en être l'enfant).
  $famille = New-Object System.Collections.Generic.List[int]
  $famille.Add($racine.Id)
  $tous | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*xyz.onlance.tracker*' } | ForEach-Object { $famille.Add([int]$_.ProcessId) }
  $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $famille.Contains([int]$_.IDProcess) }
  $detail = foreach ($x in $perf) {
    $cmd = ($tous | Where-Object { $_.ProcessId -eq $x.IDProcess }).CommandLine
    $type = if ($cmd -match '--type=([a-z-]+)') { $Matches[1] } elseif ($x.Name -like 'onlance*') { 'app (Rust)' } else { 'browser' }
    [pscustomobject]@{ Type = $type; Mo = [math]::Round($x.WorkingSetPrivate / 1MB, 1) }
  }
  [pscustomobject]@{ Total = [math]::Round(($perf | Measure-Object WorkingSetPrivate -Sum).Sum / 1MB, 1); Detail = $detail; N = $famille.Count }
}

if ($Lancer) {
  Get-Process -Name onlance -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force }
  # On attend que les processus WebView2 de l'instance précédente soient partis.
  foreach ($i in 1..20) {
    $restes = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*xyz.onlance.tracker*' }
    if (-not $restes) { break }
    Start-Sleep -Milliseconds 500
  }
  $restes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  # Lancement direct (pas par le shell Windows) : les variables d'environnement
  # comme ONLANCE_URL passent bien à l'app.
  $psi = New-Object System.Diagnostics.ProcessStartInfo $Lancer
  $psi.UseShellExecute = $false
  # Sorties redirigées : sinon l'app garde la console du script ouverte.
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  [System.Diagnostics.Process]::Start($psi) | Out-Null
  Start-Sleep -Seconds $Attente
  foreach ($i in 1..3) {
    $m = Mesurer
    if ($m) { "relevé {0} : {1} Mo" -f $i, $m.Total }
    Start-Sleep -Seconds 5
  }
}

$m = Mesurer
if (-not $m) { "On lance ? n'est pas lancé."; exit 1 }
$m.Detail | Sort-Object Mo -Descending | ForEach-Object { "{0,-18} {1,7:N1} Mo" -f $_.Type, $_.Mo }
""
"{0} processus · mémoire privée {1:N1} Mo (le chiffre du Gestionnaire des tâches)" -f $m.N, $m.Total
