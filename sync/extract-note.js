#!/usr/bin/env osascript -l JavaScript

// extract-note.js — Extracts HTML and images from the "Is it Baby Time?" Apple Note
//
// Usage: osascript -l JavaScript sync/extract-note.js [output_dir]
// Output: JSON to stdout — { html_path: string, images: [{ name: string, path: string }] }
//
// The shell sync script (sync.sh) calls this, then base64-encodes images
// and POSTs the payload to the /sync Worker endpoint.

ObjC.import("Foundation");

function run(argv) {
  var outputDir = argv[0] || "/tmp/iselodyhereyet-sync";
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;

  // Clean and create output directory
  app.doShellScript("rm -rf " + quoteShell(outputDir) + " && mkdir -p " + quoteShell(outputDir));

  // Find the note in Apple Notes
  var notes = Application("Notes");
  var allNotes = notes.notes();
  var note = null;

  for (var i = 0; i < allNotes.length; i++) {
    if (allNotes[i].name() === "Is it Baby Time?") {
      note = allNotes[i];
      break;
    }
  }

  if (!note) {
    throw new Error("Note 'Is it Baby Time?' not found in Apple Notes");
  }

  // Extract HTML body and write to file
  var htmlBody = note.body();
  var htmlPath = outputDir + "/note.html";
  writeFile(htmlPath, htmlBody);

  // Extract image attachments
  var attachments = note.attachments();
  var imageExts = { jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, heic: 1, tiff: 1, tif: 1 };
  var images = [];
  var home = app.doShellScript("echo $HOME");
  var notesMediaDir = home + "/Library/Group Containers/group.com.apple.notes";

  for (var i = 0; i < attachments.length; i++) {
    var name;
    try {
      name = attachments[i].name();
    } catch (e) {
      continue;
    }
    if (!name) continue;

    var ext = name.split(".").pop().toLowerCase();
    if (!imageExts[ext]) continue;

    // Deduplicate: if we already have an image with this name, add a suffix
    var destName = name;
    var counter = 1;
    while (images.some(function (img) { return img.name === destName; })) {
      var parts = name.split(".");
      var e = parts.pop();
      destName = parts.join(".") + "_" + counter + "." + e;
      counter++;
    }

    // Find attachment file in the Notes data directory
    try {
      var found = app.doShellScript(
        "find " + quoteShell(notesMediaDir) + " -name " + quoteShell(name) + " -type f 2>/dev/null | head -1"
      );
      if (found.trim()) {
        var destPath = outputDir + "/" + destName;
        app.doShellScript("cp " + quoteShell(found.trim()) + " " + quoteShell(destPath));
        images.push({ name: destName, path: destPath });
      }
    } catch (e) {
      // Skip attachments we can't locate
    }
  }

  return JSON.stringify({ html_path: htmlPath, images: images });
}

function writeFile(path, content) {
  var nsString = $.NSString.alloc.initWithUTF8String(content);
  nsString.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
}

function quoteShell(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
