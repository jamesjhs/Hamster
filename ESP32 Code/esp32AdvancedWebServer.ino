// DOIT ESP32 DEVKIT V1

#include <WiFi.h>
#include <NetworkClient.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <wifisetup.h>

//WiFi Setup variables (from wifisetup.h file)
//const char *ssid = "";
//const char *password = "";

// Pins required
const int led = 2;        //inbuilt
const int ledWheel = 32;  //D32
const int ledMotion = 33;
const int pinWheel1 = 35;
const int pinWheel2 = 34;
const int pinMotion1 = 18;
const int pinMotion2 = 19;
const int pinMotion3 = 21;

// WHEEL setup variables
int wheelNumberLast = 1;

int wheel1triggered = 0;
int wheel1count = 0;
unsigned long wheel1last;

int wheel2triggered = 0;
int wheel2count = 0;
unsigned long wheel2last;

float wheelDia = 13.5;                          // wheel diameter (cm)
float wheelCircumf = (3.142 * wheelDia) / 100;  // wheel circumference (m)
unsigned long timePause = 10000;                // time considered a break between runs in msec (so the average speed display and timeElapsed work properly)
unsigned long timeElapsed;

// MOTION setup variables
int motionLevelLast = 1;

int motion1Active = 0;
int motion1Count = 0;
unsigned long motion1Last;

int motion2Active = 0;
int motion2Count = 0;
unsigned long motion2Last;

int motion3Active = 0;
int motion3Count = 0;
unsigned long motion3Last;

//LOG setup variables
float distance = 0.0;
float distance1 = 0.0;
float distance2 = 0.0;
float currentspeed = 0.0;
float maxspeed = 0.0;
float avespeed = 0.0;

unsigned long lastwheelmillis = millis();
unsigned long lastmotionmillis = millis();

unsigned long lastmotion1millis;
unsigned long lastmotion2millis;
unsigned long lastmotion3millis;

float duration1Active;
float duration2Active;
float duration3Active;
float totalDuration1;
float totalDuration2;
float totalDuration3;

WebServer server(80);

void resetData() {
  wheel1count = 0;
  wheel2count = 0;
  motion1Count = 0;
  motion2Count = 0;
  motion3Count = 0;
  duration1Active = 0;
  duration2Active = 0;
  duration3Active = 0;
  totalDuration1 = 0;
  totalDuration2 = 0;
  totalDuration3 = 0;
  distance1 = 0;
  distance2 = 0;
  avespeed = 0;
  maxspeed = 0;

  server.send(200, "text/html", "All data cleared! <a href=/>Back</a>");
}


void sendmotionLevelLast() {
  char temp[100];
  snprintf(temp, 100, "%01d", motionLevelLast);
  server.send(200, "text/html", temp);
};
void sendwheelNumberLast() {
  char temp[100];
  snprintf(temp, 100, "%01d", wheelNumberLast);
  server.send(200, "text/html", temp);
};
void senddistance1() {
  char temp[100];
  snprintf(temp, 100, "%1.2f", distance1);
  server.send(200, "text/html", temp);
};
void senddistance2() {
  char temp[100];
  snprintf(temp, 100, "%1.2f", distance2);
  server.send(200, "text/html", temp);
};
void sendmaxspeed() {
  char temp[100];
  snprintf(temp, 100, "%1.2f", maxspeed);
  server.send(200, "text/html", temp);
};
void sendavespeed() {
  char temp[100];
  snprintf(temp, 100, "%1.2f", avespeed);
  server.send(200, "text/html", temp);
};
void sendmillisnow() {
  unsigned long timenow = millis();
  char temp[100];
  snprintf(temp, 100, "%02d", timenow);
  server.send(200, "text/html", temp);
};
void sendlastwheelmillis() {
  unsigned long lastwheelmillistemp = millis() - lastwheelmillis;
  char temp[100];
  snprintf(temp, 100, "%02d", lastwheelmillistemp);
  server.send(200, "text/html", temp);
};
void sendlastmotionmillis() {
  unsigned long lastmotionmillistemp = millis() - lastmotionmillis;
  char temp[100];
  snprintf(temp, 100, "%02d", lastmotionmillistemp);
  server.send(200, "text/html", temp);
};
void sendmotion1count() {
  char temp[100];
  snprintf(temp, 100, "%1.2f", totalDuration1);
  server.send(200, "text/html", temp);
};
void sendmotion2count() {
  char temp[100];
  snprintf(temp, 100, "%1.2f", totalDuration2);
  server.send(200, "text/html", temp);
};
void sendmotion3count() {
  char temp[100];
  snprintf(temp, 100, "%1.2f", totalDuration3);
  server.send(200, "text/html", temp);
};

void handleRoot() {
  int sec = millis() / 1000;
  int hr = sec / 3600;
  int min = (sec / 60) % 60;
  sec = sec % 60;

  char temp[1024];

  snprintf(
    temp, 1024,

    "<html>\
  <head>\
    <meta http-equiv='refresh' content='1'/>\
    <title>Diesel Data</title>\
    <style>\
      body { background-color: #cccccc; font-family: Arial, Helvetica, Sans-Serif; Color: #000088; }\
    </style>\
  </head>\
  <body>\
    <h1>Raw Data from Diesel</h1>\
    <p>Uptime: %02d:%02d:%02d</p>\
    <p>distance1: %1.2f\
    <br>distance2: %1.2f\
    <br>wheelNumberLast: %01d\
    <br>motion1count: %1.2f\
    <br>motion2count: %1.2f\
    <br>motion3count: %1.2f\
    <br>motionLevelLast: %01d\
    <br>lastwheelmillis: %01d\
    <br>lastmotionmillis: %01d\
    <br>maxspeed: %1.2f\
    <br>avespeed: %1.2f</p>\
    <p><a href=reset>RESET</a></p>\
  </body>\
</html>",

    hr, min, sec, distance1, distance2, wheelNumberLast, totalDuration1, totalDuration2, totalDuration3, motionLevelLast, lastwheelmillis, lastmotionmillis, maxspeed, avespeed);
  server.send(200, "text/html", temp);
}

void handleNotFound() {

  String message = "File Not Found\n\n";
  message += "URI: ";
  message += server.uri();
  message += "\nMethod: ";
  message += (server.method() == HTTP_GET) ? "GET" : "POST";
  message += "\nArguments: ";
  message += server.args();
  message += "\n";

  for (uint8_t i = 0; i < server.args(); i++) {
    message += " " + server.argName(i) + ": " + server.arg(i) + "\n";
  }

  server.send(404, "text/plain", message);
}

/*
===============================================================================================
=======================================            ============================================
======================================= SETUP LOOP ============================================
=======================================            ============================================
=============================================================================================== 
*/

void setup(void) {
  pinMode(led, OUTPUT);
  pinMode(ledWheel, OUTPUT);
  pinMode(ledMotion, OUTPUT);
  pinMode(pinWheel1, INPUT);
  pinMode(pinWheel2, INPUT);
  pinMode(pinMotion1, INPUT);
  pinMode(pinMotion2, INPUT);
  pinMode(pinMotion3, INPUT);

  digitalWrite(led, 0);
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.println("");

  // Wait for connection
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("");
  Serial.print("Connected to ");
  Serial.println(ssid);
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());

  if (MDNS.begin("esp32")) {
    Serial.println("MDNS responder started");
  }

  server.on("/", handleRoot);
  server.on("/reset", resetData);
  server.onNotFound(handleNotFound);

  // Output variables to be called:

  server.on("/d/distance1", senddistance1);
  server.on("/d/distance2", senddistance2);
  server.on("/d/maxspeed", sendmaxspeed);
  server.on("/d/avespeed", sendavespeed);
  server.on("/d/millisnow", sendmillisnow);
  server.on("/d/lastwheelmillis", sendlastwheelmillis);
  server.on("/d/lastmotionmillis", sendlastmotionmillis);
  server.on("/d/motionLevelLast", sendmotionLevelLast);
  server.on("/d/wheelNumberLast", sendwheelNumberLast);
  server.on("/d/motion1count", sendmotion1count);
  server.on("/d/motion2count", sendmotion2count);
  server.on("/d/motion3count", sendmotion3count);
  server.begin();
  Serial.println("HTTP server started");
  //  writeTime = millis() + writeDelayMsec;
}

void loop(void) {

  server.handleClient();
  delay(2);  //allow the cpu to switch to other tasks

  /*
  int sec = millis() / 1000;
  int hr = sec / 3600;
  int min = (sec / 60) % 60;
  sec = sec % 60;*/

  if (digitalRead(pinWheel1)) {  // this portion registers movement on wheel 1, incrementing this wheel's odometer AND total distance travelled
    if (wheel1triggered == 0) {
      wheel1triggered = 1;
      wheelNumberLast = 1;
      digitalWrite(ledWheel, 1);
      delay(10);
      digitalWrite(ledWheel, 0);


      if (lastwheelmillis != 0) {
        if ((millis() - lastwheelmillis) < timePause) {  // increments timeElapsed so long as the time is less than the designated break
          timeElapsed = timeElapsed + (millis() - lastwheelmillis);
          Serial.print(timeElapsed);
        }
      }

      if (millis() - lastwheelmillis < timePause) {  // displays the speed again so long as a long break hasn't occurred
        currentspeed = 1000 * wheelCircumf / (millis() - lastwheelmillis);
      }

      distance1 = distance1 + wheelCircumf;  // distance travelled in metres
      distance = distance1 + distance2;
      avespeed = distance / (timeElapsed / 1000.0);

      Serial.print("Current speed: ");
      Serial.println(currentspeed);
      Serial.print("Max speed: ");
      Serial.println(maxspeed);

      if (maxspeed < currentspeed) { maxspeed = currentspeed; };
      lastwheelmillis = millis();
      wheel1count++;
    }
  } else {
    if (wheel1triggered == 1) {
      wheel1triggered = 0;
    }
  }  //end if pinWheel1

  if (digitalRead(pinWheel2)) {  // this portion registers movement on wheel 2, incrementing this wheel's odometer AND total distance travelled
    if (wheel2triggered == 0) {
      wheel2triggered = 1;
      wheelNumberLast = 2;
      digitalWrite(ledWheel, 1);
      delay(10);
      digitalWrite(ledWheel, 0);


      if (lastwheelmillis != 0) {
        if ((millis() - lastwheelmillis) < timePause) {  // increments timeElapsed so long as the time is less than the designated break
          timeElapsed = timeElapsed + (millis() - lastwheelmillis);
          Serial.print(timeElapsed);
        }
      }

      if (millis() - lastwheelmillis < timePause) {  // displays the speed again so long as a long break hasn't occurred
        currentspeed = 1000 * wheelCircumf / (millis() - lastwheelmillis);
      }

      distance2 = distance2 + wheelCircumf;  // distance travelled in metres
      distance = distance1 + distance2;
      avespeed = distance / (timeElapsed / 1000.0);

      Serial.print("Current speed: ");
      Serial.println(currentspeed);
      Serial.print("Max speed: ");
      Serial.println(maxspeed);

      if (maxspeed < currentspeed) { maxspeed = currentspeed; };
      lastwheelmillis = millis();
      wheel2count++;
    }
  } else {
    if (wheel2triggered == 1) {
      wheel2triggered = 0;
    }
  }  //end if pinWheel2


  if (digitalRead(pinMotion1)) {
    if (motion1Active == 0) {
      digitalWrite(ledMotion, 1);
      motion1Active = 1;
      motionLevelLast = 1;
      lastmotion1millis = millis();
      lastmotionmillis = lastmotion1millis;
      Serial.print("Motion detected at ");
      Serial.println(millis() / 1000);
      motion1Count++;
    }
  } else {
    if (motion1Active == 1) {
      motion1Active = 0;
      duration1Active = (millis() - lastmotion1millis) / 1000.00;
      totalDuration1 = totalDuration1 + duration1Active;
      digitalWrite(ledMotion, 0);
    }
  }  //end if pinMotion1

  if (digitalRead(pinMotion2)) {
    if (motion2Active == 0) {
      digitalWrite(ledMotion, 1);
      motion2Active = 1;
      motionLevelLast = 2;
      lastmotion2millis = millis();
      lastmotionmillis = lastmotion2millis;
      Serial.print("Motion detected at ");
      Serial.println(millis() / 1000);
      motion2Count++;
    }
  } else {
    if (motion2Active == 1) {
      motion2Active = 0;
      duration2Active = (millis() - lastmotion2millis) / 1000.00;
      totalDuration2 = totalDuration2 + duration2Active;
      digitalWrite(ledMotion, 0);
    }
  }  //end if pinMotion2

  if (digitalRead(pinMotion3)) {
    if (motion3Active == 0) {
      digitalWrite(ledMotion, 1);
      motion3Active = 1;
      motionLevelLast = 3;
      lastmotion3millis = millis();
      lastmotionmillis = lastmotion3millis;
      Serial.print("Motion detected at ");
      Serial.println(millis() / 1000);
      motion3Count++;
    }
  } else {
    if (motion3Active == 1) {
      motion3Active = 0;
      duration3Active = (millis() - lastmotion3millis) / 1000.00;
      totalDuration3 = totalDuration3 + duration3Active;
      digitalWrite(ledMotion, 0);
    }
  }  //end if pinMotion3

}  //end LOOP()

/*
   Copyright (c) 2015, Majenko Technologies
   All rights reserved.

   Redistribution and use in source and binary forms, with or without modification,
   are permitted provided that the following conditions are met:

 * * Redistributions of source code must retain the above copyright notice, this
     list of conditions and the following disclaimer.

 * * Redistributions in binary form must reproduce the above copyright notice, this
     list of conditions and the following disclaimer in the documentation and/or
     other materials provided with the distribution.

 * * Neither the name of Majenko Technologies nor the names of its
     contributors may be used to endorse or promote products derived from
     this software without specific prior written permission.

   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
   ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
   (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
   LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
   ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
   SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/