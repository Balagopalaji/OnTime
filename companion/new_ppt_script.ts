    const script = \`
set res to "{\\"state\\":\\"none\\"}"
try
  tell application "Microsoft PowerPoint"
    set isRunning to true
    set isFront to frontmost
    set hasPres to (count of presentations) > 0
    set isInShow to (count of slide show windows) > 0
    
    set maxSlides to 0
    set filePath to ""
    if hasPres then
      try
        set activePres to active presentation
        set maxSlides to count of slides of activePres
        set filePath to (full name of activePres) as string
      on error
        -- handle unsaved or busy presentation
      end try
    end if
    
    set curSlide to 0
    if isInShow then
      try
        set curSlide to (current show position of slide show view of slide show window 1)
      on error
        set curSlide to 0
      end try
    end if
    
    set thePid to 0
    tell application "System Events"
      try
        set thePid to unix id of process "Microsoft PowerPoint"
      end try
    end tell

    set res to "{\\"state\\":\\"" & (if isFront then "foreground" else "background") & "\\",\\"instanceId\\":" & thePid & ",\\"filename\\":\\"" & filePath & "\\",\\"inSlideshow\\":" & (if isInShow then "true" else "false")
    if curSlide > 0 then set res to res & ",\\"slideNumber\\":" & curSlide
    if maxSlides > 0 then set res to res & ",\\"totalSlides\\":" & maxSlides
    set res to res & "}"
  end tell
on error err
  set res to "{\\"state\\":\\"none\\",\\"error\\":\\"" & err & "\\"}"
end try
res
\`.trim();
