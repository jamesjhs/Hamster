<html>

<head>
    <meta http-equiv="refresh" content="5">
    <title>Hamster Logger</title>
</head>

<body>


<?php
    // This is the server file pointed to from the public-facing website jameshovercraft.co.uk/diesel.php, referencing the ESP32 whose IP address is defined below.
// floor(microtime(true) * 1000) = number of milliseconds since the Unix epoch (0:00:00 January 1,1970 GMT)
    
    $esp32ip = "192.168.1.98";
    $piip = "192.168.1.72";
    $csvfile = "http://" . $piip . "/diesellogger/longtermlog.csv";

    $fileData = fopen($csvfile, 'r');
    while (($line = fgetcsv($fileData)) !== FALSE) {
        $data[] = $line;
    }
    $dataLength = sizeof($data);

    for ($row = 1; $row < $dataLength; $row++) { //doing it row by row instead of a foreach allows referencing between 
    
        $totalWheel1 += $data[$row][1];
        $totalWheel2 += $data[$row][2];
        $totalMotion1 += $data[$row][3];
        $totalMotion2 += $data[$row][4];
        $totalMotion3 += $data[$row][5];
    }

    $totalMotions = $totalMotion1 + $totalMotion2 + $totalMotion3;

    $avespeed = file_get_contents("http://" . $esp32ip . "/d/avespeed");
    $maxspeed = file_get_contents("http://" . $esp32ip . "/d/maxspeed");
    $distance1 = file_get_contents("http://" . $esp32ip . "/d/distance1");
    $distance2 = file_get_contents("http://" . $esp32ip . "/d/distance2");
    $distanceTot = $distance1 + $distance2;
    $totalWheels = $totalWheel1 + $totalWheel2 + $distanceTot;
    $wheelNumberLast = file_get_contents("http://" . $esp32ip . "/d/wheelNumberLast");
    $millisnow = file_get_contents("http://" . $esp32ip . "/d/millisnow");
    $motion1count = file_get_contents("http://" . $esp32ip . "/d/motion1count");
    $motion2count = file_get_contents("http://" . $esp32ip . "/d/motion2count");
    $motion3count = file_get_contents("http://" . $esp32ip . "/d/motion3count");
    $motionLevelLast = file_get_contents("http://" . $esp32ip . "/d/motionLevelLast");
    $lastwheelmillis = floor(microtime(true) * 1000) - file_get_contents("http://" . $esp32ip . "/d/lastwheelmillis");
    $lastmotionmillis = floor(microtime(true) * 1000) - file_get_contents("http://" . $esp32ip . "/d/lastmotionmillis");

    $lastActiveSecs = max($lastwheelmillis, $lastmotionmillis) / 1000;
    $lastActive = floor(abs(time() - $lastActiveSecs));


    if ($lastwheelmillis < $lastmotionmillis) {
        if ($motionLevelLast == 1) {
            $motionLevel = "top level";
        } elseif ($motionLevelLast == 2) {
            $motionLevel = "middle level";
        } else {
            $motionLevel = "bottom level";
        }
        ;
    } elseif ($lastwheelmillis >= $lastmotionmillis) {
        if ($wheelNumberLast == 1) {
            $motionLevel = "top wheel";
        } else {
            $motionLevel = "bottom wheel";
        }
    }

// let birthdayepoch = (new Date("2025-09-07").getTime()) / (86400000 * 365.25) ;
// let todayepoch = (new Date().getTime()) / (86400000 * 365.25);
// let diffepoch = todayepoch - birthdayepoch;
// document.getElementById("humanyears").innerHTML = diffepoch.toFixed(2);
//
// let output = Math.round(-1.3415 * (diffepoch ** 4) + 15.678 * (diffepoch ** 3) - 54.837 * (diffepoch ** 2) + 92.659 * diffepoch + 2.3173);
// document.getElementById("hamsteryears").innerHTML = output;

$birthDate = DateTime::createFromFormat('!d/m/Y', "07/09/2025");
$now = new DateTime(); // Current time

$diffSeconds = $now->getTimestamp() - $birthDate->getTimestamp();
$secondsInYear = 365.25 * 24 * 60 * 60;
$humanYears = $diffSeconds / $secondsInYear; //human years
$hamsterYears = (-1.3415 * ($humanYears ** 4) + 15.678 * ($humanYears ** 3) - 54.837 * ($humanYears ** 2) + 92.659 * $humanYears + 2.3173);
// echo number_format($hamsterYears, 2); 

// $birthdayepoch = 

    echo "\n<h1>Chocolate's Logger</h1>";
    echo "\n<h2>Total distance today: " . round($distanceTot * 0.000621371,2) . " miles (" . number_format($distanceTot/1000,2) . "km)</h2>";
    echo "\n<h2>Total distance all time: " . round($totalWheels * 0.000621371,2) . " miles (" . number_format($totalWheels/1000,2) . "km)</h2>";
    echo "\n<hr><h2>Last seen (on " . $motionLevel . ") at " . date("H:i:s", $lastActiveSecs) ." (" . number_format($lastActive / 60,0) ." mins ago)</h2>";
    echo "\n<h2>Age: " . number_format($humanYears,2) . " human years (". number_format($hamsterYears,2) ." hamster years)";

    // The following checks that the Raspberry Pi polling information from the esp32 device is running its Python script and outputting data.
    
    $pidurl = "http://" . $piip . "/diesellogger/pid.php"; // php file dumping the python script process ID - this is deleted when the process ends (but admittedly not if the system reboots)
    $headers = @get_headers($pidurl); // calling HTTP headers to check this exists or not (200 is yes, otherwise no, i.e., log not running)
    if ($headers && strpos($headers[0], '200')) {
        // echo "[Running!] Process ID: " . file_get_contents("http://".$piip."/diesellogger/pid.php")."<br>";
    } else {
        $pid = file_get_contents("http://" . $piip . "/diesellogger/startprocess.php");
        // echo "[Started!] Process ID: " . file_get_contents("http://".$piip."/diesellogger/pid.php")."<br>";
    }
    ?>

<h2><a href="#" onClick="window.location.reload();">[ REFRESH ]</a></h2>
<h2>

La-la-la-lava! Ch-ch-ch-chicken! Steve's lava chicken yeah it's tasty as hell...!

</h2>
</body>

</html>