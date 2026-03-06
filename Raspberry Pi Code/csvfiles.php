<?php 
// this file simply outputs the directory listing of dated csv files for the other server to pick up 

$folderFiles = glob("*.csv", \GLOB_BRACE);
natsort($folderFiles);
foreach (array_reverse($folderFiles) as $filename) {
	echo "$filename\n";
}

?>