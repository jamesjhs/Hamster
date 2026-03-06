<?php 
// this file simply reflects the output from the ROWSON server

      if (!isset($dataInline)) { ?>


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

<meta property="og:url" content="https://www.jameshovercraft.co.uk/diesel" />
<meta property="og:type" content="website" />
<meta property="og:title" content="The adventures of Chocolate the Hamster" />
<meta property="og:description" content="A webpage entirely detailing the movements and activity of our Russian Dwarf Hamster called Chocolate, using an ESP32 system-on-a-chip (SOC) and a Raspberry Pi" />
<meta property="og:image" content="https://lh3.googleusercontent.com/pw/AP1GczP97wGZhFkKZHHAtFzpYpCeU5V939t1-REGrQr3tn9aCMPBZxeMHQ0Ck2OD414CHK4quMgtUPJ0FS2v_zxX-pwtxkirRNXtywkIz_P1OpLyCu8oKLlWpHcU5Xf05nWmpH2l_fJPjy7arR-ilxFk3rb2pA=w1920-h865-s-no-gm" />



<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <title>The adventures of Chocolate the Hamster :: Activity Log</title>
</head>
<body>
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

<a name="top"></a><h1>Chocolate's Activity Log<font size='0.5em'> [<a href=index.php>BACK TO MAIN PAGE</a>]</font></h1>

      <?php }
	  
$args="";
echo "<p>Showing data from server...</p>";
if ($_SERVER["REQUEST_METHOD"] == "POST") {
  $formresult = htmlspecialchars($_POST['csvfile']);
  if (empty($formresult)) { 
    echo "No file specified, showing default data.";
  } else {
    echo "Showing data from file: ".$formresult;    
  $csvfile = $formresult;
	  $args = "?csvfile=".$csvfile;
  }
} else { }

echo file_get_contents("http://guest:G53st!@jhs2000.ddns.net/diesel/datatable.php".$args);

   if (!isset($dataInline)) { ?>

</div>
</body>
</html>

<?php }

 ?>