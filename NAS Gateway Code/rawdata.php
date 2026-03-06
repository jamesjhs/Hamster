<?php 
// This is the server file pointed to from the public-facing website jameshovercraft.co.uk/diesel.php, referencing the ESP32 whose IP address is defined below.
// floor(microtime(true) * 1000) = number of milliseconds since the Unix epoch (0:00:00 January 1,1970 GMT)

$esp32ip = "192.168.1.98";
$piip = "192.168.1.72";

// The following checks that the Raspberry Pi polling information from the esp32 device is running its Python script and outputting data.

$pidurl = "http://".$piip."/diesellogger/pid.php"; // php file dumping the python script process ID - this is deleted when the process ends (but admittedly not if the system reboots)
$headers = @get_headers($pidurl); // calling HTTP headers to check this exists or not (200 is yes, otherwise no, i.e., log not running)
if($headers && strpos( $headers[0], '200')) { 
    // echo "[Running!] Process ID: " . file_get_contents("http://".$piip."/diesellogger/pid.php")."<br>";
} 
else { 
    $pid = file_get_contents("http://".$piip."/diesellogger/startprocess.php");
    // echo "[Started!] Process ID: " . file_get_contents("http://".$piip."/diesellogger/pid.php")."<br>";
} 

// echo($pidfilestatus); 

$csvfile = "http://".$piip."/diesellogger/longtermlog.csv";

$fileData=fopen($csvfile,'r');
while (($line = fgetcsv($fileData)) !== FALSE) {
   $data[] = $line;
}
$dataLength = sizeof($data);

    for ($row = 1; $row <$dataLength; $row++) { //doing it row by row instead of a foreach allows referencing between 
              
        $totalWheel1  += $data[$row][1];
        $totalWheel2  += $data[$row][2];
        $totalMotion1 += $data[$row][3];
        $totalMotion2 += $data[$row][4];
        $totalMotion3 += $data[$row][5];
    }
    
$totalWheels  = $totalWheel1 + $totalWheel2;
$totalMotions = $totalMotion1 + $totalMotion2 + $totalMotion3;

$avespeed = file_get_contents("http://".$esp32ip."/d/avespeed");
$maxspeed = file_get_contents("http://".$esp32ip."/d/maxspeed");
$distance1 = file_get_contents("http://".$esp32ip."/d/distance1");
$distance2 = file_get_contents("http://".$esp32ip."/d/distance2");
$wheelNumberLast = file_get_contents("http://".$esp32ip."/d/wheelNumberLast");
$millisnow = file_get_contents("http://".$esp32ip."/d/millisnow");
$motion1count = file_get_contents("http://".$esp32ip."/d/motion1count");
$motion2count = file_get_contents("http://".$esp32ip."/d/motion2count");
$motion3count = file_get_contents("http://".$esp32ip."/d/motion3count");
$motionLevelLast = file_get_contents("http://".$esp32ip."/d/motionLevelLast");
$lastwheelmillis = floor(microtime(true) * 1000) - file_get_contents("http://".$esp32ip."/d/lastwheelmillis");
$lastmotionmillis = floor(microtime(true) * 1000) - file_get_contents("http://".$esp32ip."/d/lastmotionmillis");

echo "\n\$maxspeed = " . $maxspeed.";"; 
echo "\n\$distance1 = " . $distance1.";"; 
echo "\n\$distance2 = " . $distance2.";"; 
echo "\n\$motion3count = " . $motion3count.";"; 
echo "\n\$motion2count = " . $motion2count.";"; 
echo "\n\$motion1count = " . $motion1count.";"; 
echo "\n\$wheelNumberLast = " . $wheelNumberLast.";"; 
echo "\n\$motionLevelLast = " . $motionLevelLast.";"; 
echo "\n\$lastwheelmillis = " . $lastwheelmillis.";"; 
echo "\n\$lastmotionmillis = " . $lastmotionmillis.";"; 
echo "\n\$totalWheel1 = " . $totalWheel1.";"; 
echo "\n\$totalWheel2 = " . $totalWheel2.";"; 
echo "\n\$totalMotion1 = " . $totalMotion1.";"; 
echo "\n\$totalMotion2 = " . $totalMotion2.";"; 
echo "\n\$totalMotion3 = " . $totalMotion3.";"; 

?></p>