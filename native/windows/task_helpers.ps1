function Get-ReservationTime([object]$value) {
    # PS7 may deserialize an ISO string as DateTime; PS5 keeps a string.
    if ($value -is [DateTimeOffset]) {
        $scheduled = $value
    } elseif ($value -is [DateTime]) {
        $scheduled = [DateTimeOffset]$value
    } else {
        $scheduled = [DateTimeOffset]::Parse([string]$value, [Globalization.CultureInfo]::InvariantCulture)
    }
    return $scheduled.ToOffset([TimeSpan]::FromHours(8))
}

function Get-FailureWatchArguments([string]$sourcePath, [string]$reservationPath, [object]$scheduledValue) {
    $scheduled = Get-ReservationTime $scheduledValue
    $iso = $scheduled.ToString('yyyy-MM-ddTHH:mm:sszzz', [Globalization.CultureInfo]::InvariantCulture)
    return ('"{0}" watch --reservation "{1}" --scheduled-at "{2}"' -f $sourcePath, $reservationPath, $iso)
}
