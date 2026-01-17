set res to "{}"
set isRunning to false
set isFront to false
set thePid to 0

try
  tell application "System Events"
    set procList to every application process whose name is "Microsoft PowerPoint"
    if (count of procList) > 0 then
      set isRunning to true
      set theProc to item 1 of procList
      set thePid to unix id of theProc
      set frontApp to name of first application process whose frontmost is true
      if frontApp contains "PowerPoint" then set isFront to true
    end if
  end tell
end try

if not isRunning then
  return "{\"state\":\"none\"}"
end if

set curSlide to 0
set maxSlides to 0
set isInShow to false
set filePath to ""

try
  tell application "Microsoft PowerPoint"
    if (count of presentations) > 0 then
      set activePres to active presentation
      set maxSlides to (count of slides of activePres)
      try
        set filePath to (full name of activePres) as string
      end try
      if (count of slide show windows) > 0 then
        set isInShow to true
        set curSlide to (current show position of slide show view of slide show window 1)
      end if
    end if
  end tell
end try

set res to "{\"state\":\""
if isFront then
  set res to res & "foreground"
else
  set res to res & "background"
end if
set res to res & "\",\"instanceId\":" & thePid
set res to res & ",\"filename\":\"" & filePath & "\""
if isInShow then
  set res to res & ",\"inSlideshow\":true"
else
  set res to res & ",\"inSlideshow\":false"
end if

if curSlide > 0 then set res to res & ",\"slideNumber\":" & curSlide
if maxSlides > 0 then set res to res & ",\"totalSlides\":" & maxSlides
set res to res & "}"
return res
