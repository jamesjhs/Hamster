<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>


<link rel="stylesheet" type="text/css" href="/style/normalize.css" />
<link rel="stylesheet" type="text/css" href="/style/style.css" />
<link rel="stylesheet" type="text/css" href="/style/style-mobile.css" />
<link rel="stylesheet" type="text/css" href="/style/style-medium.css" />
<link rel="stylesheet" type="text/css" href="/style/style-desktop.css" />
<link rel="stylesheet" type="text/css" href="/style/print.css" media="print" />
<link rel="shortcut icon" href="favicon.ico" type="image/x-icon" />

<meta name="keywords" content="hamster, russian dwarf, monitor, pets, remote access, php, python, Visual Studio, esp32, expressif, arduino, SOC, system-on-a-chip, IDE, html, coding, design, backend, server, raspberry pi, motion sensor, reed switch, magnets, project, DIY, geek, how-to" />
<meta name="description" content="A webpage entirely detailing the movements and activity of our Russian Dwarf Hamster called Chocolate, using an ESP32 system-on-a-chip (SOC) and a Raspberry Pi">

<meta property="og:url" content="https://www.jameshovercraft.co.uk/diesel.php" />
<meta property="og:type" content="website" />
<meta property="og:title" content="The adventures of Chocolate the Hamster" />
<meta property="og:description" content="A webpage entirely detailing the movements and activity of our Russian Dwarf Hamster called Chocolate, using an ESP32 system-on-a-chip (SOC) and a Raspberry Pi" />
<meta property="og:image" content="https://lh3.googleusercontent.com/pw/AP1GczP97wGZhFkKZHHAtFzpYpCeU5V939t1-REGrQr3tn9aCMPBZxeMHQ0Ck2OD414CHK4quMgtUPJ0FS2v_zxX-pwtxkirRNXtywkIz_P1OpLyCu8oKLlWpHcU5Xf05nWmpH2l_fJPjy7arR-ilxFk3rb2pA=w1920-h865-s-no-gm" />


<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />


    <script type="text/javascript">

        function ageCalculate() {

            let birthdayepoch = (new Date("2025-09-07").getTime()) / (86400000 * 365.25) ;
            let todayepoch = (new Date().getTime()) / (86400000 * 365.25);
            let diffepoch = todayepoch - birthdayepoch;
            document.getElementById("humanyears").innerHTML = diffepoch.toFixed(2);

            let output = Math.round(-1.3415 * (diffepoch ** 4) + 15.678 * (diffepoch ** 3) - 54.837 * (diffepoch ** 2) + 92.659 * diffepoch + 2.3173);
            document.getElementById("hamsteryears").innerHTML = output;

        	};


    </script>



<title>The adventures of Chocolate the Hamster</title>
</head>
<body onLoad="ageCalculate();">
<div id="wrapper">

<button onclick="topFunction()" id="topButton" title="Go to top">Top</button>
<script type="text/javascript">
// Get the button:
let mybutton = document.getElementById("topButton"); 

// When the user scrolls down 20px from the top of the document, show the button
window.onscroll = function() {scrollFunction()};

function scrollFunction() {
  if (document.body.scrollTop > 20 || document.documentElement.scrollTop > 20) {
    mybutton.style.display = "block";
  } else {
    mybutton.style.display = "none";
  }
}

// When the user clicks on the button, scroll to the top of the document
function topFunction() {
  document.body.scrollTop = 0; // For Safari
  document.documentElement.scrollTop = 0; // For Chrome, Firefox, IE and Opera
}

</script>


<a name="top"></a><h1>The Adventures of Chocolate the Hamster</h1>
<p>These are the voyages of Chocolate, the Russian Dwarf hamster...</p>
<p>Absolutely no hamsters were harmed in the making of this project, as it is entirely done via remote sensing! As far as we can tell, 
Diesel's privacy has not been invaded; he still pees in a secret corner and buries other waste products - and he has so far to lodge a complaint 
to the house council despite being given ample notice and chances to do so. A plus side of monitoring him is that, perhaps in theory, his activity level
may even be a proxy for his health and happiness - hamsters do love a good spin on their wheels!</p>
<p><h2>Page contents:</h2></p>
<ul>
<li><a href="#basicdata">Basic data</a></li>
<li><a href="#source">Source files</a></li>
<li><a href="#g_dieselhamster">Image gallery of progress</a></li>
<li><a href="#development">Development log</a></li>
<li><a href="#graphs">Graphical output</a></li>
<li><a href="#datatable">Data table</a></li>
</ul>
</p>

<p align=center><img alt="Chocolate the Hamster" src="chocolate.jpg" width="600"></p>
<p align=center>Hamster years: <span id="hamsteryears" > hamsteryears </span>; Human years: <span id="humanyears"> humanyears </span></p>


<?php include "basicdata.php"; ?>

<pre>

<b>Previous hamster (Diesel) all-time log:</b>
Last wheel turn: 2025-11-17 03:28:40 on wheel 2

Wheel 1 distance travelled: 17142.98 m
Wheel 2 distance travelled: 25760.4 m
Total distance travelled: 42903.38 m

Top floor sensor time: 45709.98 s
Middle floor sensor time: 49667.17 s
Ground floor sensor time: 57775.11 s
Total sensor time: 153152.26 s
Diesel's age: 83 hamster years (2.43 human years)</pre>
<hr>
<h2><a name="source">Source Files</a> <font size='0.5em'>[<a href='#top'>TOP</a>]</font></h2>
<p>The following files linked provide the basic functionality of the whole project</p>
<ul><li><a href="https://1drv.ms/u/s!AnajXvlxJV0KjoIaS6gic9fctxz0lQ?e=ayxHpH" target=_blank>Main Arduino .ino project (C++)</a></li>
<li><a href="https://1drv.ms/u/s!AnajXvlxJV0KjodCENt6pvmEDy4yPw?e=A7Xsr5" target=_blank>Raspberry Pi data logger (Python)</a></li>
<li><a href="https://1drv.ms/u/s!AnajXvlxJV0KjowTC8VGVCrrp_HnHw?e=sAmpaK" target=_blank>Public-facing tabulated data and graphs (PHP/HTML/JavaScript)</a></li>
</ul>
<hr>

  <?php include $_SERVER['DOCUMENT_ROOT']."/includes/galroot.php";  ?>
  <?php $galName = "g_"."dieselhamster"; include $_SERVER['DOCUMENT_ROOT']."/includes/makegallery.php";  ?>
<hr>
<h2><a name="development">Development log timeline</a> <font size='0.5em'>[<a href='#top'>TOP</a>]</font></h2>
<ul>
    <li>
        <article>
            <h3>15/12/24 - Started the project</h3>
            <ul>
                <li>
                    Identified "need" - how do we know how healthy our hamster is? When does he do his exercise? How fast does he run? How far does he run?
                    Let's get a reed switch and a magnet on his wheel, and do some calculations using C++ on an Espressif ESP32 WROOM32 DEVKIT1 that I've got lying around...
                    (I'd already proved the code concept using a Teensy 2.0 (Arduino-like chip), counting wheel revolutions and basic maths to calculate activity time/etc.)
                    This code step was simply to test the WiFi capabilities of the ESP32 and run a rudimentary webserver displaying the status of a connected switch.
                </li>
            </ul>
        </article>
    </li>
</ul>
<ul>
    <li>
        <article>
            <h3>16/12/24 - Adding wheel spin data</h3>
            <ul>
                <li>
                    Iterative update to the code to calculate wheel circumference (i.e., diameter * pi) and a cumulative log of distance (i.e.,
                    <code>distance = distance + circumference</code> every time the wheel spun round by one revolution. Capturing a wheel spin event
                    is not as simple as <code> if (digitalRead(reedSwitch)) {wheelSpins ++;}</code> because this would generate a rapid increase in the value
                    of <b>wheelSpins</b> for however long the switch was active. Instead first a varaible <b>reedSwitchState</b> must be set to high on detecting a
                    trigger, and and if() statement created to only increment <b>wheelSpins</b> if the value was previously == 0. The resetting of the switch to LOW did the opposite,
                    i.e., setting reedSwitchState to LOW as well, and only doing so if the value was previously == 1:
                    <pre>
  if (digitalRead(pinSwitch)) {
    if (switchPressed == 0) {
      digitalWrite(led, 1);
      digitalWrite(ledReed, 1);
      delay(10);
      digitalWrite(led, 0);
      digitalWrite(ledReed, 0); // at this time an LED was connected as a debugging tool to determine the if statements were working.
      switchPressed = 1;
      wheelLast = millis();
      Serial.print("Wheel spin at ");
      Serial.println(millis()/1000);
      switchCount++;
    }
  } else {
    if (switchPressed == 1) {
      switchPressed = 0;
    }  
  } //end if pinSwitch
  </pre>
                    Instantaneous speed was calculated
                    by taking the <code>millis()</code> value at the time the reed switch was triggered last time and subtracting this from the current <code>millis()</code>
                    value, then dividing the wheel circumference by this difference in time. Top speed was simply determined by
                    <code>if (speednow > maxspeed) {maxspeed = speednow};</code>The ESP32's webpage at this point simply dumped the variables
                    <b>reed switch state</b> and <b>distance travelled</b> to its only response page.
                </li>
            </ul>
        </article>
    </li>
</ul>
<ul>
    <li>
        <article>
            <h3>16/12/24 - Adding wheelspin data</h3>
            <ul>
                <li>
                    Iterative update to the code to calculate wheel circumference (i.e., diameter * pi) and a cumulative log of distance (i.e.,
                    <code>distance = distance + circumference</code> every time the wheel spun round by one revolution. Instantaneous speed was calculated
                    by taking the <code>millis()</code> value at the time the reed switch was triggered last time and subtracting this from the current value,
                    then dividing the wheel circumference by this difference in time. Top speed was simply determined by
                    <code>if (speednow > maxspeed) {maxspeed = speednow};</code>. The ESP32's webpage at this point simply dumped the variables
                    <b>reed switch state</b> and <b>distance travelled</b> to its only response page.
                </li>
            </ul>
        </article>
    </li>
</ul>

<ul>
    <li>
        <article>
            <h3>17/12/24 - Adding a motion sensor</h3>
            <ul>
                <li>
                    Using an arduino-compatible motion sensor (such as <a href="https://www.instructables.com/How-to-Use-a-PIR-Motion-Sensor-With-Arduino/" target="_blank">this one</a>),
                    a second variable, i.e., tracking movement, was possible. The sensor goes high when it detects movement, and drops to low again when movement ceases.
                    The variable <b>motionCount</b> was created to simply log the number of times motion was detected, i.e.,
                    <code>motionCount = motionCount++;</code> whenever <code>if (digitalRead(pinMotion))</code> became true.
                </li>
            </ul>
        </article>
    </li>
</ul>

<ul>
    <li>
        <article>
            <h3>18/12/24 - Updating the server outputs to make an API</h3>
            <ul>
                <li>
                    Now the rudimentary steps were understood, it was time to take things further and enable a more human interface for the ESP32,
                    as well as the ability to poll it remotely. It wouldn't be sensible to have it accessed straight through a firewall via an open port,
                    considering the potential for easy hacking, so polling data from it via a server call i.e., <code>http://esp32.local/d/motionCount</code>
                    meant that a more secure device, such as a Raspberry Pi or even NAS, could query it and display the data sensibly. So the following variables
                    were created to allow this:
                    <ul>
                        <li><b>distance</b> - total distance travelled, i.e., motionCount * wheelCircumference</li>
                        <li><b>maxspeed</b> - as described above</li>
                        <li><b>avespeed</b> - total distance / time spent moving (i.e., ignoring gaps > 10 seconds)</li>
                        <li><b>millisnow</b> - current boot epoch time, an <i>unsigned long</i>, for the ESP32, in milliseconds</li>
                        <li><b>lastwheelmillis</b> - value of millis() last time a wheel spin was detected</li>
                        <li><b>lastmotionmillis</b> - ditto for movement being sensed</li>
                        <li><b>motioncount</b> - number of times motion detected</li>
                    </ul>
                </li>
            </ul>
        </article>
    </li>
</ul>


<ul>
    <li>
        <article>
            <h3>19/12/24 - Introducing PYTHON and the Raspberry Pi</h3>
            <ul>
                <li>
                    It now became highly necessary to not just display the data from the chip in a sensible manner, using PHP calls from a
                    Raspberry Pi running <b>Apache 3</b> and <b>PHP</b>, but also I thought it would be nice to have a bit more granular data,
                    not just knowing total distances travelled and maximum speeds, but the ability to scroll back through time and see
                    how the data has changed. Thus, Python was invoked, to regularly poll data from the ESP32 and store the variables below into a .csv file:
                    <ul>
                        <li><b>distance</b></li>
                        <li><b>motionCount</b></li>
                    </ul>
                    Python (a surprisingly pleasant programming language to use following the data type-pernickety C++), was able to simply loop through its
                    polling code,
                    <pre>

import requests
import time
import os
import argparse

def retrieveandsave(i):
    distance = str(requests.get("http://" + esp32IP + "/d/distance").content)
    distance = distance.replace("b","")
    distance = distance.replace("'","")
    distance = str(float(distance))

    motioncount = str(requests.get("http://" + esp32IP + "/d/motioncount").content)
    motioncount = motioncount.replace("b","")
    motioncount = motioncount.replace("'","")
    motioncount = str(int(round(float(motioncount))))

    outstring = (str(time.time()) +","+ distance +","+ motioncount)
    with open(outfile, 'a') as f:
        print(outstring, end="\n", file=f)

    print("Saved line " + str(i))
    time.sleep(delay)

        </pre> either indefinitely or for a certain number of repetitions, as defined by input arguments to the program. It wasn't necessary to compile
                    the script to run stand-alone as it doesn't need to be real-time or processor-intensive, simply pinging the ESP32 every 30 seconds or so
                    is enough to generate a fairly large .CSV file.
                </li>
            </ul>
        </article>
    </li>
</ul>


<ul>
    <li>
        <article>
            <h3>20/12/24 - Making a lovely front-end</h3>
            <ul>
                <li>
                    This webpage is the end-result of generating the CSV file mentioned above, and parsing it out to a "user-friendly" webpage - which is
                    still a work-in-progress of course. The CSV file is taken by PHP server-side, and broken down into individual rows of the array <b>$data[]</b>,
                    using the following code, <pre>
        
$fileData=fopen($csvfile,'r');
while (($line = fgetcsv($fileData)) !== FALSE) {
   $data[] = $line;
}
$dataLength = sizeof($data);
        </pre>Each line of the resulting array is then checked to see if it matches the line above, and if so, ignored. At present the data is simply pumped
                    out into a tabular format using good old fashioned HTML tables, but the plan going forward is to make this data table adjustable in JavaScript
                    to allow a specific time windows, and also eventually to make a vector graphics (SVG) graph of time vs. distance travelled, motion triggers, and possibly
                    even running speed (over the captured data polled windows of 30-45 seconds). As of the time of writing, I've just about managed to make a sine wave out of the
                    SVG with a bit of text overlay, and the data is in very long scrolling table.
                </li>
            </ul>
        </article>
    </li>
</ul>


<ul>
    <li>
        <article>
            <h3>22/12/24 - Unexpected spanner in the works</h3>
            <ul>
                <li>
                    A very excitable wife and children have resulted in Diesel the hamster being gifted a three-layer house, instead of the bungalow cage
                    in which he was inhabiting up until today. His new mansion now has two wheels, slides, and an overhanging sleeping area. This means I'm going
                    to have to adapt my ESP32 wiring and code to account for THREE motion sensors, and TWO reed switches, as opposed to simply one of each!
                    Amazon orders have been made...
                </li>
            </ul>
        </article>
    </li>
</ul>


<ul>
    <li>
        <article>
            <h3>23/12/24 - Three movement sensors and two wheel sensors</h3>
            <ul>
                <li>
                    The challenge accepted - and thankfully renaming a few variables and (perhaps lazily) copying some code to define <code>if()</code> loops for each wheel and each 
                    level of the cage has resulted in being able to output several variables where once lay only two, namely, <b>distance1</b> and <b>distance2</b>, and <b>motion1count</b>, 
                    <b>motion2count</b> and <b>motion3count</b>. The info logger on the Raspberry Pi needed updating to record five variables instead of three, and additional variables 
                    <b>wheelNumberLast</b> and <b>motionLevelLast</b> were created so that the output can reflect which wheel was used last and which level Diesel was last seen on.
                </li>
            </ul>
        </article>
    </li>
</ul>

<ul>
    <li>
        <article>
            <h3>28/12/24 - Javascript Chart.js updates</h3>
            <ul>
                <li>
                    A fair amount of work went into the client-side behind-the-scenes JavaScript today, with the abandonment of the original static SVG-based chart output in preference
					for an includable publicly-available JavaScript library called <a href="https://www.w3schools.com/js/js_graphics_chartjs.asp" target="_blank">chart.js</a>, 
					"one of the simplest visualization libraries for JavaScript, and comes with the many built-in chart types". There's a small amount of server-side work in the
					PHP file, to generate five XY lists for the scatterplot, which annoyingly cannot accept simply array columns but must be in the format "<code>x: 000, y: 000";</code>
					ideally it'd be nice to just have a selector enabling or disabling array column calls (i.e., <b>dataarray[0]</b> vs <b>dataarray[4]</b>, but that seems not to be possible.
                </li>
            </ul>
        </article>
    </li>
</ul>

<ul>
    <li>
        <article>
            <h3>29/12/24 - Javascript Chart.js updates</h3>
            <ul>
                <li>
                    More front-end updating behind the scenes, now the chart has three lines and is over a date axis rather than UNIX time; also, a legend now exists. The table output
					has also had a spruce-up with cell background colours reflecting the cell values (via incorporating the formula 
					<code>((250-$contrast)+(($maxMotion1abs - $data[$row][4])/$maxMotion2abs)*$contrast)</code> within the <code>style="background-color:rgb(r,g,b);"</code> element.
                </li>
            </ul>
        </article>
    </li>
</ul>


<ul>
    <li>
        <article>
            <h3>31/12/24 - Events become seconds</h3>
            <ul>
                <li>
                    The motion sensors have two different output modes, depending on the position of Jumper <b>J1</b> (the external-most setting being signal ON trigger, 
					the inner-most setting being signal WHILE triggered). A re-write of the ESP32 C++ code to summate the time taken while triggered (float), as opposed to just incrementing
					a trigger count (integer), I feel makes for more granular data. The sensors aren't the world's most reliable methods of determining fine-detected movement, as they
					have only a limited field of view (especially in something so small as a hamster cage), and also on cessation of movement detection, require three seconds to be
					reactivated. However, if Diesel keeps moving in front of their fields of view during this time, his movement should be recorded in seconds (to 2 decimal places). The changed code
					was as follows, to accommodate seconds instead of just a simple count:
<pre>

  if (digitalRead(pinMotion1)) {
    if (motion1Active == 0) {
      digitalWrite(ledMotion, 1);
      motion1Active = 1;
      motionLevelLast = 1;
      lastmotion1millis = millis();
      <b>lastmotionmillis = lastmotion1millis;</b>
      Serial.print("Motion detected at ");
      Serial.println(millis() / 1000);
      motion1Count++;
    }
  } else {
    if (motion1Active == 1) {
      motion1Active = 0;
      <b>duration1Active = (millis() - lastmotion1millis) / 1000.00;</b>
      <b>totalDuration1 = totalDuration1 + duration1Active;</b>
      digitalWrite(ledMotion, 0);
    }
  }  //end if pinMotion1
</pre>
                </li>
            </ul>
        </article>
    </li>
</ul>


<ul>
    <li>
        <article>
            <h3>4/01/25 - Wheels now attached</h3>
            <ul>
                <li>
                    Hurrah! After quite a long wait, I had a brainwave while trying to measure how far the reed switch (basically a magnetic on/off sensor)
                would need to protrude into the cage. I had initially thought I'd 3D print something to lie alongside his wheel, anchored from the outside of the cage, and have the reed switch slide in to. But in measuring the wheel with a biro, it hit me: use a biro! So 10 minutes in the garage cutting 5mm thick slivers of 2x2 pine and drilling four holes for cable ties and one hole for the biro, and sawing the tube of a biro to length, and we now have a working wheel sensor. Plugged it into the breadboard and she worked off the bat!</li>
            </ul>
        </article>
    </li>
</ul>


<ul>
    <li>
      <article>
            <h3>6/01/25 - Daily Logs now available!</h3>
            <ul>
                <li>
                    A bit of back-end fiddling today, I have updated the Python script to use <code> outfile = datetime.now().strftime("%Y") + datetime.now().strftime("%m") + datetime.now().strftime("%d") + ".csv"</code> instead of a standard "datalogger.csv" filename, 
                thereby allowing daily logs to be generated on the Raspberry Pi, changing name at midnight. The Pi's webserver now has a simple script simply to find .csv files within the logging directory, which in turn is called by the front-end webpage and presented as a drop-down selection box to choose which logfile you want to view. </li>
            </ul>
        </article>
    </li>
</ul>


<ul>
    <li>
      <article>
            <h3>7/01/25 - Daily reset of variables</h3>
            <ul>
                <li>Just a quick one. Tried to figure out the best way to do allow the logfiles and subsequent information
					to display data fresh for each day. I thought about rewriting the python code in the Raspberry Pi
					to take the difference between two polled readings from the ESP32, and even rewriting the ESP32
					code to simply output said difference between each access, but quickly realised the
					workload doing this would involve re-writing the scripts for every bit of the data analysis side
					(i.e., scripts for the graphs, tables, and csv file generator) AND refashioning each logfile to incorporate
					the change to the parsers. Instead, it seems obvious now: at time the value of the current hour is 
					LESS than the previously stored value, i.e., 0 vs 23 then call the RESET programme from the ESP32. In the case of 
					clocks going back, because they only do this by one hour, this should not fail (as 01:59:59 rolls over to 01:00:00).
					<br><br>The limitation to this method is that of power failure, whereupon the ESP32 chip will reset all its data
					back to 0, so a step-change would be noted within the CSV data, and an according severe negative shift be noted in the table and 
					presented data. I will amend the parser to recognise if a negative result occurs, and simply add on the difference to subsequent 
					lines.</li>
            </ul>
        </article>
    </li>

</ul>



<ul>
    <li>
      <article>
            <h3>13/01/25 - Re-jigging of the log files and enabling daily digests</h3>
            <ul>
                <li>Well I'm sorry it's been a while - though I somewhat doubt there's anyone actually reading this but if you are there, please drop me a line using
				the main website Comments page (<a href="/hover/contact.php">click here</a>!). I've been letting the logs build up a bit, with keen interest, 
				and notice that Diesel is indeed using both wheels, though preferring his upper one (away from his sleeping quarters), and is active once every
				three hours of so day or night - which is interesting. I've been editing the logfiles so that they are in keeping with the "up to date" standard
				of the logfiles now, i.e., changing filename at midnight, and providing only a cumulative log from 0 each day. Via the addition of the following 
				code within the main Raspberry Pi python script, a new file is also being made which saves Diesel's total efforts of the day into a summary logfile,
				though I haven't yet written a parser for this. 
<pre>
    if lasthour > int(datetime.now().strftime("%H")):
        outstring = (str(time.time()) + ","+ distance1 + ","+ distance2 +","+ motion1count+","+ motion2count+","+ motion3count)
        outfile = "longtermlog.csv"
        with open(outfile, 'a') as f:
            print(outstring, end="\n", file=f)
        reset = str(requests.get("http://" + esp32IP + "/reset").content)

    else: 
        outstring = (str(time.time()) + ","+ distance1 + ","+ distance2 +","+ motion1count+","+ motion2count+","+ motion3count)
        outfile = datetime.now().strftime("%Y%m%d") + ".csv"
        with open(outfile, 'a') as f:
            print(outstring, end="\n", file=f)
</pre></li>
            </ul>
        </article>
    </li>

</ul>


<ul>
    <li>
      <article>
            <h3>28/01/25 - Data analysis templates updated, logfile selector updated</h3>
            <ul>
                <li>Changed the way the log file selector works on the Data Table / Graph page, so now the drop-down shows the dd/mm/yyyy result of the logfile name
					instead of its raw csv file value. Also allows the inclusion of longtermlog.csv to be referenced, and in a human-friendly way. Behind the scenes
					the logfiles are still called via their filenames and passed to the <code>datatable.php</code> page. Graph programming was a bit tricky as the original 
					parser script was designed for cumulative data rather than absolute, but this was tweaked using an if/else statement in the code, i.e., 
					<code>if ( $logfile = "longtermlog.csv" ) { <i>parse as non-cumulative</i> } else { <i>parse as cumulative</i> }; </code>.
					<br><br>Also now edited is the <code>basicdata.php</code> file, which is now able to summate the daily log values from the longtermlog.csv file 
					enabling long-term totals of data since logging began. Turns out that little Diesel has run quite a long way since the early days: 2.3km and counting!</li>
            </ul>
        </article>
    </li>

</ul>


<ul>
    <li>
        <article>
            <h3>Plans for the future</h3>
            <ul>
                <li>
                    The following will be updated as more progress is made...
                    <ul>
                        <li>Making a suitable case for the veroboard instead of having the breadboards just sitting below Diesel's cage</li>
						<li>Data analysis metrics?</li>
                    </ul>
                </li>
            </ul>
        </article>
    </li>
</ul>


<?php 

$dataInline = 1;
include "datatable.php";

?>
<script type="text/javascript">
document.getElementById("standalone").innerHTML = "<a href=datatable.php>Click to view data output on its own</a>.";
</script>

</div>
</body>
</html>
