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

The launcher currently bundles `manifests/shadows-stable.json` for verification. For production patching, upload the same source files so they match the manifest URLs:

```text
https://aethro.net/launcher/shadows/stable/files/<relative file path>
```

When the pack changes, update `ShadowPackSource`, rerun the command, and rebuild the launcher.

## Fabric Loader

The launcher repair step also installs a normal Minecraft Launcher profile named `Shadows of Aethro`.

That profile:

- points `gameDir` at the patched Shadows instance folder
- uses the Fabric loader profile for the manifest's Minecraft version
- writes the Fabric version JSON into the user's `.minecraft/versions/` folder
- stores the pack JVM args from the manifest

The official Minecraft Launcher should then download Fabric's libraries when the profile is launched.
