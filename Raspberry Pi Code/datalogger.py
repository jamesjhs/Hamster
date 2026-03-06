import requests
import time
import os
from datetime import datetime, timedelta

processid = str(os.getpid())

outstring = datetime.now().strftime("%H:%M:%S") + " :: PROGRAM STARTED (Process ID: " + processid + ")"
logfile = datetime.now().strftime("%Y%m%d") + "-log.txt"
with open(logfile, 'a') as f:
    print(outstring, end="\n", file=f)

#import argparse
#parser = argparse.ArgumentParser(description='Diesel Data Logger')
#parser.add_argument("--reps", type=int, default=5)
#parser.add_argument("--delay", type=int, default=10)
#args = parser.parse_args()
#repetitions = args.reps
#delay = args.delay
#repetitions = int(input("How many repetitions? (0 = indefinite): "))
#delay = int(input("Enter time delay between repetitions in seconds: "))

lasthour = 0
repetitions = 0
delay = 30
j = 0

# print ("Process ID: " + str(os.getpid()))

killpidphp = "<?php exec(\"kill -9 " + processid + "\"); exec(\"rm -f 'killpid.php'\"); exec(\"rm -f 'pid.php'\");?>Killed " + processid + '<p><a href=\"/diesellogger/\">Home</a></p>'
killpidfile = "killpid.php"

with open(killpidfile, 'w') as f:
    print(killpidphp, end="\n", file=f)

pidphp = "<?php echo (" + processid + ");?>"
processidfile = "pid.php"

with open(processidfile, 'w') as f:
    print(pidphp, end="\n", file=f)

esp32IP = "192.168.1.98"

def retrieveandsave():
    global lasthour

    distance1 = str(requests.get("http://" + esp32IP + "/d/distance1").content)
    distance1 = distance1.replace("b","")
    distance1 = distance1.replace("'","")
    distance1 = str(float(distance1))

    distance2 = str(requests.get("http://" + esp32IP + "/d/distance2").content)
    distance2 = distance2.replace("b","")
    distance2 = distance2.replace("'","")
    distance2 = str(float(distance2))

    motion1count = str(requests.get("http://" + esp32IP + "/d/motion1count").content)
    motion1count = motion1count.replace("b","")
    motion1count = motion1count.replace("'","")
    motion1count = str(float(motion1count))

    motion2count = str(requests.get("http://" + esp32IP + "/d/motion2count").content)
    motion2count = motion2count.replace("b","")
    motion2count = motion2count.replace("'","")
    motion2count = str(float(motion2count))

    motion3count = str(requests.get("http://" + esp32IP + "/d/motion3count").content)
    motion3count = motion3count.replace("b","")
    motion3count = motion3count.replace("'","")
    motion3count = str(float(motion3count))

    if lasthour > int(datetime.now().strftime("%H")):
        outstring = (str(time.time()) + ","+ distance1 + ","+ distance2 +","+ motion1count+","+ motion2count+","+ motion3count)
        outfile_daily = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d") + ".csv"
        with open(outfile_daily, 'a') as f:
            print(outstring, end="\n", file=f)
        outfile = "longtermlog.csv"
        with open(outfile, 'a') as f:
            print(outstring, end="\n", file=f)
        reset = str(requests.get("http://" + esp32IP + "/reset").content)

    else: 
        outstring = (str(time.time()) + ","+ distance1 + ","+ distance2 +","+ motion1count+","+ motion2count+","+ motion3count)
        outfile = datetime.now().strftime("%Y%m%d") + ".csv"
        with open(outfile, 'a') as f:
            print(outstring, end="\n", file=f)

    lasthour = int(datetime.now().strftime("%H"))
    time.sleep(delay)

while True:
    try:
        if repetitions == 0:
            outstring = datetime.now().strftime("%H:%M:%S") + " infinite repetitions; delay = " + str(delay) + "seconds"
            logfile = datetime.now().strftime("%Y%m%d") + "-log.txt"
            with open(logfile, 'a') as f:
                print(outstring, end="\n", file=f)
            retrieveandsave()

        else:
            for i in range(repetitions):
                outstring = datetime.now().strftime("%H:%M:%S") + " limited repetitions; delay = " + str(delay) + ", repetitions= " + str(repetitions) + "i = " + str(i) + ", j: " + str(j)
                logfile = datetime.now().strftime("%Y%m%d") + "-log.txt"
                with open(logfile, 'a') as f:
                    print(outstring, end="\n", file=f)
                retrieveandsave()
                j+=1

        if j > repetitions:
            outstring = datetime.now().strftime("%H:%M:%S") + "End of loop"
            logfile = datetime.now().strftime("%Y%m%d") + "-log.txt"
            with open(logfile, 'a') as f:
                print(outstring, end="\n", file=f)
            break
    
    except Exception as e:
        outstring = datetime.now().strftime("%H:%M:%S") + 'Caught exception: ' + str(e)
        logfile = datetime.now().strftime("%Y%m%d") + "-log.txt"
        with open(logfile, 'a') as f:
            print(outstring, end="\n", file=f)
        time.sleep(delay)