# Launcher music packs

Music is selected by game hub and respects the player’s single launcher mute and
volume controls. The launcher ships the existing Shadows tracks today. Kalismor and
Reforged intentionally show no tracks until real licensed music is provided; they do
not silently reuse another game’s soundtrack.

When adding a pack, provide a title and an HTTPS MP3 URL through the game-hub metadata
contract. Keep each track under a sensible download size, use a clean loop-friendly
start/end, and confirm that Aethro has permission to distribute it in the launcher.

The player controls are persistent UI preferences only. The launcher does not report
listening activity or send music selections to an API.
