<?php 
// This is the server file pointed to from the public-facing website jameshovercraft.co.uk/diesel, referencing the ESP32 whose IP address is defined below.
// floor(microtime(true) * 1000) = number of milliseconds since the Unix epoch (0:00:00 January 1,1970 GMT)
// excel formula for UNIX time = ((( UNIXTIME /60)/60)/24) + DATE(1970,1,1)

$esp32ip = "192.168.1.98";
$piip = "192.168.1.72";

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


$csvFilesList = "http://".$piip."/diesellogger/csvfiles.php";
$fileData=fopen($csvFilesList,'r');
$i=0;
while (($line = fgetcsv($fileData)) !== FALSE) {
   $csvList[$i] = $line;
   $i++;
}
$csvFilesNumber = sizeof($csvList);

$csvpath = "http://".$piip."/diesellogger/";
$csvfile = ($csvList[1])[0];

$formresult = $_GET['csvfile']; 
if (isset($formresult)) {
    $formresult = str_replace(";","",$formresult);
    $formresult = str_replace("csv",".csv",preg_replace('/[^A-Za-z0-9 ]/', '', $formresult));
    $csvfile = $formresult;
}

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    
  $formresult = str_replace(";","",htmlspecialchars($_POST['csvfile']));
  $formresult = str_replace("csv",".csv",preg_replace('/[^A-Za-z0-9 ]/', '', $formresult));

  if (empty($formresult)) {
  } else {
      $csvfile = $formresult;
  }
} else {  }

// FORM to allow CSV file selection 
echo "<h2>Data output</h2>\n";
echo "<form method='POST' action='".$_SERVER['PHP_SELF']."'>\n";
echo "<label for 'csvfile'>Choose a log file: </label><select id='csvfile' name='csvfile' onchange='this.form.submit()'>\n";

for ($i = 0; $i<$csvFilesNumber; $i++) {
    if ($csvfile == ($csvList[$i])[0]) {
        $selected=" selected='selected'";
        $selectStar=" *";
        } 
    else {
        $selected="";
        $selectStar="";
        }

        if (($csvList[$i])[0] == "longtermlog.csv") {
            $csvPlaintext = "Long term logfile";
        } else {
            $csvPlaintextSrc = str_replace(".csv", "", ($csvList[$i])[0]);
            $csvPlaintext = substr($csvPlaintextSrc,6,2) . "/" . substr($csvPlaintextSrc,4,2) . "/" . substr($csvPlaintextSrc,0,4);
        }

    echo "<option value='".($csvList[$i])[0]."'$selected>".$csvPlaintext.$selectStar."</option>\n";
}
echo "</select></p></form>"; // END of form

$csvnopath = $csvfile;
$csvfile = $csvpath.$csvfile;

$fileData=fopen($csvfile,'r');
while (($line = fgetcsv($fileData)) !== FALSE) {
   $data[] = $line;
}
$dataLength = sizeof($data);

?>
<html>
<head>
<title>Diesel's Data Graph</title>
</head>

<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/2.9.4/Chart.js"></script>

<script type="text/javascript">
function displayArray() {
    var firsttime  = new Date(dataarray[0][0]*1000);
    var lasttime  = new Date(dataarray[dataarray.length-1][0]*1000);
    var datecol = dataarray[0][0];
    var firstdatetime = firsttime.toLocaleDateString("en-GB") +" " + firsttime.toLocaleTimeString("en-GB");
    var lastdatetime = lasttime.toLocaleDateString("en-GB") +" " + lasttime.toLocaleTimeString("en-GB");

    document.getElementById("dataoutput").innerHTML = "Start Date: " + firstdatetime + "<br>End Date: " + lastdatetime+"<br>";
}

let dataarray = [

<?php 

    for ($row = 1; $row <$dataLength; $row++) { //doing it row by row instead of a foreach allows referencing between 
         echo "[" . $data[$row][0] . ', '. $data[$row][1]  . ', '. $data[$row][2] . ', '. $data[$row][3] . ', '. $data[$row][4] . ', '. $data[$row][5]. "],\n";
                     
            $maxWheel1abs = max ($data[$row][1], $maxWheel1abs);
            $maxWheel2abs = max ($data[$row][2], $maxWheel2abs);
            $maxMotion1abs = max ($data[$row][3], $maxMotion1abs);
            $maxMotion2abs = max ($data[$row][4], $maxMotion2abs);
            $maxMotion3abs = max ($data[$row][5], $maxMotion3abs);

            if ($csvnopath == "longtermlog.csv") {
                
                $maxWheel1 = max ($data[$row][1], $maxWheel1);
                $totalWheel1 += $data[$row][1];
                $maxWheel2 = max ($data[$row][2], $maxWheel2);
                $totalWheel2 += $data[$row][2];
                $maxMotion1 = max ($data[$row][3], $maxMotion1);
                $totalMotion1 += $data[$row][3];
                $maxMotion2 = max ($data[$row][4], $maxMotion2);
                $totalMotion2 += $data[$row][4];
                $maxMotion3 = max ($data[$row][5], $maxMotion3);
                $totalMotion3 += $data[$row][5];

            } else {

                $maxWheel1 = max (($data[$row+1][1] - $data[$row][1]), $maxWheel1);
                $maxWheel2 = max (($data[$row+1][2] - $data[$row][2]), $maxWheel2);
                $maxMotion1 = max (($data[$row+1][3] - $data[$row][3]), $maxMotion1);
                $maxMotion2 = max (($data[$row+1][4] - $data[$row][4]), $maxMotion2);
                $maxMotion3 = max (($data[$row+1][5] - $data[$row][5]), $maxMotion3);

            }

         $maxWheels = max ($maxWheels, $maxWheel1, $maxWheel2);
         $maxMotions = max ($maxMotions, $maxMotion1, $maxMotion2, $maxMotion3);
         $totalWheels = $totalWheel1 + $totalWheel2;
         $totalMotions = $totalMotion1 + $totalMotion2 + $totalMotion3;  
     }
?>

];

</script>

</head>
<body onLoad="displayArray();">

<p><h2><a name="graphs">Chart.JS output</a> <font size='0.5em'>[<a href='#top'>TOP</a>]<div id="standalone"></div></font></h2></p>
<p>The following uses the JavaScript include from <a href="https://www.w3schools.com/js/js_graphics_chartjs.asp" target="_blank">https://www.w3schools.com/js/js_graphics_chartjs.asp</a>.</p>

<canvas id="LayersChartLINE" style="width:100%;max-width:700px"></canvas>
<canvas id="WheelChartLINE" style="width:100%;max-width:700px"></canvas>
<script> 

// https://www.w3schools.com/js/js_graphics_chartjs.asp 

// X-AXIS TIMES
// excel formula for UNIX time = =((( UNIXTIME /60)/60)/24) + DATE(1970,1,1)

var minimum = dataarray[0][0];
var maximum = dataarray[dataarray.length-1][0];

// MOTION SENSORS

let XMotions = [
<?php for ($row = 1; $row <$dataLength; $row++) { //doing it row by row instead of a foreach allows referencing between 
         
         if ( $csvnopath == "longtermlog.csv") { 
             
                echo "\"" . gmdate("Y-m-d", $data[$row][0]) . "\", ";  

             }
             else {
                echo "\"" . gmdate("H:i:s", $data[$row][0]) . "\", ";  

            }
            }
         ?> 
];

let YMotion1 = [
<?php for ($row = 1; $row <$dataLength; $row++) { //doing it row by row instead of a foreach allows referencing between 
         if ( $csvnopath == "longtermlog.csv") { 
             echo ($data[$row][3]). ", "; 
             } 
        else {
            echo ($data[$row+1][3] - $data[$row][3]). ", ";  
            }
            }
         ?> 
];

let YMotion2 = [
<?php for ($row = 1; $row <$dataLength; $row++) { //doing it row by row instead of a foreach allows referencing between 
         if ( $csvnopath == "longtermlog.csv") { 
             echo ($data[$row][4]). ", "; 
             } 
        else {
            echo ($data[$row+1][4] - $data[$row][4]). ", ";  
            }
            }
         ?> 
];

let YMotion3 = [
<?php for ($row = 1; $row <$dataLength; $row++) { //doing it row by row instead of a foreach allows referencing between 
    if ( $csvnopath == "longtermlog.csv") { 
        echo ($data[$row][5]). ", "; 
        } 
        else {     
            echo ($data[$row+1][5] - $data[$row][5]). ", ";  
         }
         }
         ?> 
];

// WHEELS 


let XWheels = [
<?php for ($row = 1; $row <$dataLength; $row++) { //doing it row by row instead of a foreach allows referencing between 

    
         if ( $csvnopath == "longtermlog.csv") { 
             
                echo "\"" . gmdate("Y-m-d", $data[$row][0]) . "\", ";  

             }
             else {
                echo "\"" . gmdate("H:i:s", $data[$row][0]) . "\", ";  

            }
            }
         ?> 

];

let YWheel1 = [
<?php for ($row = 1; $row <$dataLength; $row++) { //doing it row by row instead of a foreach allows referencing between 
        if ( $csvnopath == "longtermlog.csv") { 
            echo ($data[$row][1]). ", "; 
            } 
        else {
            echo ($data[$row+1][1] - $data[$row][1]). ", ";  
        }
        }
        ?> 
];

let YWheel2 = [
<?php for ($row = 1; $row <$dataLength; $row++) { //doing it row by row instead of a foreach allows referencing between 
            if ( $csvnopath == "longtermlog.csv") { 
                echo ($data[$row][2]). ", "; 
                } 
        else {
             echo ($data[$row+1][2] - $data[$row][2]). ", ";  
            }
            }
         ?> 
];


new Chart("LayersChartLINE", {
  type: "line",
  data: {
    labels: XMotions,
    datasets: [{
      fill: false,
      borderColor: "rgb(255,0,0)",
      label: "Bottom floor",  
      pointRadius: 0,
      data: YMotion1
    },{
      fill: false,
      borderColor: "rgb(0,255,0)",
      label: "Middle floor",  
      pointRadius: 0,
      data: YMotion2
    },{
      fill: false,
      borderColor: "rgb(0,0,255)",
      label: "Top floor",  
      pointRadius: 0,
      data: YMotion3
    }]
  },
  options: {
    legend: {display: true},    
    title: {display: true,  text: "Activity by Level in Cage (seconds)"},
    scales: {
      xAxes: [{ticks: {min: minimum, max: maximum }}],
      yAxes: [{ticks: {min: 0, max:<?php echo $maxMotions;?>}}],
    }
  }
});


new Chart("WheelChartLINE", {
  type: "line",
  data: {
    labels: XWheels,
    datasets: [{
      fill: false,
      borderColor: "rgb(255,0,0)",
      label: "Bottom wheel",  
      pointRadius: 0,
      data: YWheel1
    },{
      fill: false,
      borderColor: "rgb(0,0,255)",
      label: "Top wheel",  
      pointRadius: 0,
      data: YWheel2
    }]
  },
  options: {
    legend: {display: true},    
    title: {display: true,  text: "Distance Travelled on Each Wheel (metres)"},
    scales: {
      xAxes: [{ticks: {min: minimum, max: maximum }}],
      yAxes: [{ticks: {min: 0, max:<?php echo $maxWheels;?>}}],
    }
  }
});
</script>

<hr>
<p><h2><a name="datatable">Data table</a> <font size='0.5em'>[<a href='#top'>TOP</a>]</font></h2></p>

<p><div id="dataoutput">HTML To Be Changed</div></p>
<table border="1" cellspacing="2" cellpadding="2" width="100%" >
  <tr>
    <th scope="col" style='background-color:rgb(200,200,200);'>Row</th>
    <th scope="col" >Date/Time</th>
    <th scope="col" >Bottom Wheel Distance (m)</th>
    <th scope="col" >Top Wheel Distance (m)</th>
    <th scope="col" >Total Distance (m)</th>
    <th scope="col" >Bottom Layer activity (s)</th>
    <th scope="col" >Middle Layer activity (s)</th>
    <th scope="col" >Top Layer activity (s)</th>
    <th scope="col" >Total activity (s)</th>
  </tr>
  
  <tr>
    <td align="center" style='background-color:rgb(200,200,200);'><?php echo $dataLength; ?></td>
    <td align="center"></td>
    <td align="center"><?php
    
        
        if ( $csvnopath == "longtermlog.csv") {  
            echo "Total: ". $totalWheel1; 
        } else {
            echo "Max diff: ". $maxWheel1; 
        }
    ?></td>
    <td align="center"><?php 
        
        if ( $csvnopath == "longtermlog.csv") {  
            echo "Total: ". $totalWheel2; 
        } else {
            echo "Max diff: ". $maxWheel2; 
        }
    ?></td>
    <td align="center"><?php 
        
        if ( $csvnopath == "longtermlog.csv") {  
            echo "Total: ". $totalWheels; 
        } else {}
    ?></td>
    <td align="center"><?php 
        
        
        if ( $csvnopath == "longtermlog.csv") {  
            echo "Total: ". $totalMotion1; 
        } else { 
            echo "Max diff: ". $maxMotion1; 
        }
    ?></td>
    <td align="center"><?php 
        
        if ( $csvnopath == "longtermlog.csv") {  
            echo "Total: ". $totalMotion2; 
        } else {
            echo "Max diff: ". $maxMotion2; 
        }
    ?></td>
    <td align="center"><?php 
        
        if ( $csvnopath == "longtermlog.csv") {  
            echo "Total: ". $totalMotion3; 
        } else {
            echo "Max diff: ". $maxMotion3; 
        }
    ?></td>
    <td align="center"><?php 
        
        if ( $csvnopath == "longtermlog.csv") {  
            echo "Total: ". $totalMotions; 
        } else {}
    ?></td>
  </tr>
<?php 

$contrast = 100; 


for ($row = 1; $row <$dataLength; $row++) { //doing it row by row instead of a foreach allows referencing between rows
    // csv: time, distance1, distance2, motion1count, motion2count, motion3count
    if (($data[$row][1]+$data[$row][2] == $data[$row+1][1]+$data[$row+1][2]) and ($data[$row][3]+$data[$row][4]+$data[$row][5] == $data[$row+1][3]+$data[$row+1][4]+$data[$row+1][5])) {  
    }
    else {
        echo "<tr>";
        echo "\n<td align='center' style='background-color:rgb(200,200,200);'>". $row . "</td>";
        
        if ( $csvnopath == "longtermlog.csv") {  
            echo "\n<td align='center'>". gmdate("d/m/Y", $data[$row][0]) . "</td>"; //Time
        } else {
            echo "\n<td align='center'>". gmdate("H:i:s", $data[$row][0]) . "</td>"; //Time
        }
        
        echo "\n<td align='center' style='background-color:rgb(255,".((250-$contrast)+(($maxWheel1abs - $data[$row][1])/$maxWheel1abs)*$contrast).",".((250-$contrast)+(($maxWheel1abs - $data[$row][1])/$maxWheel1abs)*$contrast).");'>". $data[$row][1] . "</td>"; //distance1
        echo "\n<td align='center' style='background-color:rgb(".((250-$contrast)+(($maxWheel2abs - $data[$row][2])/$maxWheel2abs)*$contrast).",".((250-$contrast)+(($maxWheel2abs - $data[$row][2])/$maxWheel2abs)*$contrast).",255);'>". $data[$row][2] . "</td>"; //distance2
        echo "\n<td align='center'>". ($data[$row][1] + $data[$row][2]) . "</td>"; //(total distance)
        echo "\n<td align='center' style='background-color:rgb(255,".((250-$contrast)+(($maxMotion1abs - $data[$row][3])/$maxMotion1abs)*$contrast).",".((250-$contrast)+(($maxMotion1abs - $data[$row][3])/$maxMotion1abs)*$contrast).");'>". $data[$row][3] . "</td>"; //motion1count
        echo "\n<td align='center' style='background-color:rgb(".((250-$contrast)+(($maxMotion1abs - $data[$row][4])/$maxMotion2abs)*$contrast).",255,".((250-$contrast)+(($maxMotion2abs - $data[$row][4])/$maxMotion2abs)*$contrast).");'>". $data[$row][4] . "</td>"; //motion2count
        echo "\n<td align='center' style='background-color:rgb(".((250-$contrast)+(($maxMotion1abs - $data[$row][5])/$maxMotion3abs)*$contrast).",".((250-$contrast)+(($maxMotion3abs - $data[$row][5])/$maxMotion3abs)*$contrast).",255);'>". $data[$row][5] . "</td>"; //motion3count
        echo "\n<td align='center'>". ($data[$row][3]+$data[$row][4]+$data[$row][5]) . "</td>"; // (total motion count)
        echo "\n</tr>\n";
    }

} ?> </table>

</body>
</html>