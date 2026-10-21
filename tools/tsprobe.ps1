param([string]$Path)
# Minimal MPEG-TS PMT parser: prints stream types per PID.
$b = [IO.File]::ReadAllBytes($Path)
$types = @{ 0x01='MPEG-1 video'; 0x02='MPEG-2 video'; 0x03='MP1/MP2 audio'; 0x04='MP2 audio'; 0x0F='AAC (ADTS)'; 0x11='AAC (LATM)';
            0x15='ID3 metadata'; 0x1B='H.264'; 0x24='HEVC'; 0x81='AC-3'; 0x87='E-AC-3'; 0x06='private (PES)' }
$descTags = @{ 0x6A='AC-3'; 0x7A='E-AC-3'; 0x59='DVB subtitles'; 0x56='teletext'; 0x0A='lang' }
$pmtPid = -1
for ($i = 0; $i + 188 -le $b.Length; $i += 188) {
  if ($b[$i] -ne 0x47) { continue }
  $pusi = ($b[$i+1] -band 0x40) -ne 0
  $tsPid = (($b[$i+1] -band 0x1F) -shl 8) -bor $b[$i+2]
  if (-not $pusi) { continue }
  $p = $i + 4
  if ($b[$i+3] -band 0x20) { $p += 1 + $b[$p] }
  $p += 1 + $b[$p]  # pointer field
  if ($tsPid -eq 0 -and $pmtPid -lt 0) {
    $pmtPid = (($b[$p+10] -band 0x1F) -shl 8) -bor $b[$p+11]
  } elseif ($tsPid -eq $pmtPid -and $b[$p] -eq 0x02) {
    $secLen = (($b[$p+1] -band 0x0F) -shl 8) -bor $b[$p+2]
    $end = $p + 3 + $secLen - 4
    $pil = (($b[$p+10] -band 0x0F) -shl 8) -bor $b[$p+11]
    $q = $p + 12 + $pil
    while ($q -lt $end) {
      $st = $b[$q]; $epid = (($b[$q+1] -band 0x1F) -shl 8) -bor $b[$q+2]
      $esl = (($b[$q+3] -band 0x0F) -shl 8) -bor $b[$q+4]
      $d = $q + 5; $extra = @()
      while ($d -lt $q + 5 + $esl) {
        $t = $b[$d]; $l = $b[$d+1]
        if ($descTags.ContainsKey([int]$t)) {
          if ($t -eq 0x0A) { $extra += 'lang=' + [Text.Encoding]::ASCII.GetString($b, $d+2, 3) } else { $extra += $descTags[[int]$t] }
        }
        $d += 2 + $l
      }
      $name = if ($types.ContainsKey([int]$st)) { $types[[int]$st] } else { '0x{0:X2}' -f $st }
      '  PID {0,5}  {1,-15} {2}' -f $epid, $name, ($extra -join ', ')
      $q += 5 + $esl
    }
    break
  }
}
