# Audio Playback Debug Guide

## How to Monitor Audio Behavior

### Open Browser Console
- **Chrome/Edge**: Press `F12` or `Ctrl+Shift+I`
- **Firefox**: Press `F12` or `Ctrl+Shift+K`
- Go to the **Console** tab

### What You'll See

The audio manager now logs detailed information. Look for messages like:

```
[AudioManager] Initialized
[AudioManager] Restoring: time=45.32s, wasPlaying=true
[AudioManager] Set position to 45.32s
[AudioManager] Playback resumed

[UnlockSite] Site unlocking...
[UnlockSite] Starting music from beginning
[UnlockSite] Music started successfully
[UnlockSite] Scheduling page reload in 2 seconds
```

## Expected Behavior

### Scenario 1: Normal Page Navigation (Memories → Reasons)
```
Console Output:
[AudioManager] Already restored on this page, skipping
✅ Music continues from same position - NO RESTART
```

### Scenario 2: Countdown Reaches Zero (Site Unlocks)
```
Console Output:
[UnlockSite] Site unlocking...
[UnlockSite] Starting music from beginning
[UnlockSite] Music started successfully
[UnlockSite] Reloading page...
[AudioManager] Initialized (after page reload)
[AudioManager] Restoring: time=0.50s, wasPlaying=true
[AudioManager] Playback resumed
✅ Music plays from beginning and continues smoothly
```

### Scenario 3: First Page Load (No Saved State)
```
Console Output:
[AudioManager] Initialized
[AudioManager] Restoring: time=0, wasPlaying=false
✅ No music plays (default state)
```

## If Music Keeps Restarting

Check the console for these messages:

### Problem: Music disabled
```
[AudioManager] Music disabled, not restoring
```
**Solution**: Click the music button (♫) to enable it

### Problem: Browser blocked autoplay
```
[AudioManager] Autoplay blocked: NotAllowedError: play() failed because user didn't interact with the document first
```
**Solution**: This is normal! Click anywhere on the page and music will play. It's a browser security feature.

### Problem: Site is locked
```
[AudioManager] Site locked, not restoring
```
**Solution**: Wait for countdown to reach zero to unlock

## Testing Tips

1. **For music continuation**: 
   - Click music button to enable
   - Navigate between pages (Memories → Reasons → Letter)
   - Watch console - should show "Already restored"

2. **For automatic unlock** (requires modifying date):
   - Open browser console
   - Type: `localStorage.setItem('debugUnlock', '1')`
   - Refresh page
   - Countdown will immediately reach zero

3. **To clear all audio state**:
   - Open console
   - Type: `localStorage.clear()`
   - Refresh page

## Audio State Storage

The following is saved in browser's **localStorage**:

- `hb_audio_lastTime` - Current playback position (in seconds)
- `hb_audio_wasPlaying` - Whether audio was playing (true/false)
- `hb_music_enabled` - User's music preference (1/0)

These persist across page reloads and browser sessions.
