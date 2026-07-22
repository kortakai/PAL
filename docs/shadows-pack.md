# Shadows Pack Manifest

The Shadows client pack source currently lives outside this repo:

```text
/Users/paul/Documents/ShadowPackSource
```

That folder should look like the Minecraft instance root users need, for example:

```text
mods/
servers.dat
config/
resourcepacks/
```

Generate the launcher manifest with:

```sh
npm run manifest:shadows -- /Users/paul/Documents/ShadowPackSource manifests/shadows-stable.json
```

The generator:

- walks every file in the source folder
- skips `.DS_Store`, `Thumbs.db`, and `desktop.ini`
- writes relative paths, file sizes, SHA-256 hashes, and hosted download URLs
- writes the manifest to `manifests/shadows-stable.json`

The launcher checks the remote manifest first:

```text
https://aethro.net/launcher/shadows/stable/manifest.json
```

It keeps the bundled `manifests/shadows-stable.json` only as a fallback if the website manifest is unavailable.

For production patching, upload the generated manifest plus the same source files so they match the manifest URLs:

```text
https://aethro.net/launcher/shadows/stable/files/<relative file path>
```

When the pack changes:

1. Update `/Users/paul/Documents/ShadowPackSource`.
2. Rerun the manifest command.
3. Upload `manifests/shadows-stable.json` to the website as `launcher/shadows/stable/manifest.json`.
4. Upload the source files under `launcher/shadows/stable/files/`.

You do not need a launcher rebuild for normal modpack changes once users have a launcher version that supports the remote manifest.

## Fabric Loader

The launcher repair step also installs a normal Minecraft Launcher profile named `Shadows of Aethro`.

That profile:

- points `gameDir` at the patched Shadows instance folder
- uses the Fabric loader profile for the manifest's Minecraft version
- writes the Fabric version JSON into the user's `.minecraft/versions/` folder
- stores the pack JVM args from the manifest

The official Minecraft Launcher should then download Fabric's libraries when the profile is launched.
