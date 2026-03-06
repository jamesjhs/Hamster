<!doctype="html">
<html>
    
<head>

</head>
<body>
<hr>
<h2><a name="basicdata">Basic data</a> <font size='0.5em'>[<a href='#top'>TOP</a>]</font></h2>
<?php 
// This is the server file pointed to from the public-facing website jameshovercraft.co.uk/diesel.php, referencing the ESP32 whose IP address is defined below.
// floor(microtime(true) * 1000) = number of milliseconds since the Unix epoch (0:00:00 January 1,1970 GMT)

$esp32ip = "192.168.1.98";
$piip = "192.168.1.72";
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

$totalWheel1 += $distance1;
$totalWheel2 += $distance2;
$totalMotion1 += $motion1count;
$totalMotion2 += $motion2count;
$totalMotion3 += $motion3count;

$totalWheels  = $totalWheel1 + $totalWheel2 ;
$totalMotions = $totalMotion1 + $totalMotion2 + $totalMotion3 ;

echo "\n<p><b>TODAY:</b><br>"; 
echo "\n Maximum speed: " . $maxspeed . " m/sec<br>"; 
echo "\n Wheel 1 distance travelled: " . $distance1 . " m<br>"; 
echo "\n Wheel 2 distance travelled: " . $distance2 . " m<br>"; 
echo "\n <i>Total distance travelled</i>: " . ($distance1 + $distance2) . " m<br><br>"; 

echo "\n Top floor sensor time: " . $motion3count." s<br>"; 
echo "\n Middle floor sensor time: " . $motion2count." s<br>"; 
echo "\n Ground floor sensor time: " . $motion1count." s<br>"; 
echo "\n <i>Total sensor time</i>: " . ($motion1count + $motion2count + $motion3count) ." s<br><br>"; 

echo "\n Last wheel turn: " . date("Y-m-d H:i:s", substr($lastwheelmillis, 0, 10))." on wheel ".$wheelNumberLast."<br>"; 
echo "\n Last motion detected: " . date("Y-m-d H:i:s", substr($lastmotionmillis, 0, 10))." on level ".$motionLevelLast."</p>\n"; 


echo "\n<p><b>ALL TIME:</b><br>"; 
echo "\n Wheel 1 distance travelled: " . $totalWheel1 . " m<br>"; 
echo "\n Wheel 2 distance travelled: " . $totalWheel2 . " m<br>"; 
echo "\n <i>Total distance travelled</i>: " . $totalWheels . " m<br><br>"; 

echo "\n Top floor sensor time: " . $totalMotion1." s<br>"; 
echo "\n Middle floor sensor time: " . $totalMotion2." s<br>"; 
echo "\n Ground floor sensor time: " . $totalMotion3." s<br>"; 
echo "\n <i>Total sensor time</i>: " . $totalMotions." s</p>\n"; 


// The following checks that the Raspberry Pi polling information from the esp32 device is running its Python script and outputting data.

$pidurl = "http://".$piip."/diesellogger/pid.php"; // php file dumping the python script process ID - this is deleted when the process ends (but admittedly not if the system reboots)
$headers = @get_headers($pidurl); // calling HTTP headers to check this exists or not (200 is yes, otherwise no, i.e., log not running)
if($headers && strpos( $headers[0], '200')) { 
    echo "[Running!] Process ID: " . file_get_contents("http://".$piip."/diesellogger/pid.php")."<br>";
} 
else { 
    $pid = file_get_contents("http://".$piip."/diesellogger/startprocess.php");
    echo "[Started!] Process ID: " . file_get_contents("http://".$piip."/diesellogger/pid.php")."<br>";
} 

?></p>
</body>
</html>