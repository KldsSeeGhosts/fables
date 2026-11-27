# Voice input

Dictate into the composer, citation comments, diff/file annotations, PR comments, and desktop browser annotations. Transcripts land in your draft for review—nothing is sent to an agent until you submit.

## Choose where audio goes

On web and desktop, you choose where transcription runs.
Nothing is sent until you choose one: open **Settings → Voice** and set
**Transcribe with** to the environment that should transcribe for you.
On a new device, the microphone or dictation shortcut opens that setting from the composer.
Microphone audio recorded on this device is sent to that environment over your
authenticated connection, transcribed there, and discarded. The choice is saved
on this device only, so every computer and browser you use asks for it once.
Set it back to **Off** at any time; a recording in progress is discarded.

If the chosen environment goes offline, voice input waits for it. Fables never
substitutes another environment.

In the desktop app on macOS 26 or later, you can instead choose **Apple Speech**
under **On this Mac**. Audio stays on the Mac and macOS transcribes it. The first
recording in a language can take longer while macOS downloads its speech model.
**Language** set to automatic uses your Mac's language. Silence filtering and
filler-word removal are not available; the dictionary applies only when transcript
cleanup is on.

For cloud dictation, choose **OpenAI** or **Grok Voice Transcribe** via the environment
you want to use. If it needs a key, enter one and choose **Save and enable**.
You can also choose a [secret provider](secrets.md) instead of **Value** and enter a
reference. Unlock the vault on that environment before dictating. Anyone with
dictation access to the environment can use the key, but only this device opts in.
If a key is already saved, just confirm the provider. After
you stop, the environment forwards your recording and any vocabulary hints to
the selected provider, which bills its API account. No local model download or chat
subscription is needed. Switch back to **This device** on mobile or **Off** on
web and desktop to stop sharing. Removing the key stops that provider for everyone
on the environment.

**OpenRouter** works the same way but has no default model: pick one from its live
speech-to-text catalog when you enable it, or later under **Manage OpenRouter**.
The model choice is yours alone and needs no settings access, so anyone with
dictation access can pick a different model without touching the saved key.
OpenRouter chooses who runs the model. T3 requests zero data retention; your
OpenRouter account can also allow safety retention. If no endpoint qualifies,
dictation fails instead of switching models.
Vocabulary hints are not sent to OpenRouter; dictionary spellings are applied
after transcription. If OpenRouter stops listing your model, dictation stops
until you choose another.

## Set up a model

In **Settings → Voice → Transcription**, download a model and choose **Use model** if it
isn’t already selected. **Test model** lets you try it without sending a message.
If you use the composer microphone before a model is installed, it offers to download one.
The recommendation uses your Voice language, or your system’s preferred languages with **Auto-detect**.

If another app already downloaded one of these models, you don’t need a second copy.
**Download** first looks in Handy’s model folder and the Hugging Face cache on that
environment and uses a copy it finds there instead of downloading. For a copy anywhere
else, on web or desktop, paste the path of the model file or its folder under the model
list and choose **Use existing**. The path is on the environment
that transcribes, not on the device you are using. Fables checks that the file is exactly a
model from its list and then uses it in place. Removing the model in Fables leaves your file
alone; if the other app deletes it, download or link the model again. Files in another
format, such as Core ML, ONNX, or MLX builds of the same model, can’t be used.

Select the languages you dictate in to compare models that support all of them.
Accuracy shows how often the model got words or characters wrong in each
language; speed is the time to transcribe 30 seconds on a reference CPU or GPU,
matching the selected environment's transcription backend. Recommendations use
the same reference tier for every selected language. Choose **All languages** to
browse without a language preference. Filtering does not switch your model.

**Advanced** controls GPU or CPU use and when an idle model is unloaded. With hardware set to
**Auto**, a recording that fails on the GPU is retried once on that same
environment's CPU; a GPU you picked yourself reports the error instead. Nothing
is ever retried on another environment. Models marked **Live preview** show
text while you speak. On web and desktop, turn off **Advanced → Streaming transcription**
to transcribe with the same model after stopping instead. This may help when live
transcription falls behind. The preference is saved on this device and only applies
to models that support native streaming. Other models can process long recordings in chunks at pauses
while you record; models with built-in long-form support transcribe when you stop.

## Dictate

Press the microphone in the composer, or `mod+shift+d` (`mod` is Command on
macOS and Ctrl elsewhere). While you record, the microphone shows live bars and
Send becomes Stop. Press the shortcut again, the bars, or Stop to finish; `Esc`
discards the recording and leaves your draft unchanged. Recordings last up to
five minutes. Text is inserted at the cursor or replaces the selection you had
when recording started, and the editor is read-only while dictation runs.
Changes that reach the draft meanwhile, such as a cited message, are kept;
the text then goes after your selection instead of replacing it.
A file or thread you paste or drop in meanwhile can be removed by focusing its
chip and pressing Backspace or Delete.

Using your send shortcut while dictating finishes the recording and sends the
draft once the transcript has been inserted. Cancelling also cancels that queued send. In
the other editors, Save, Comment, Reply, Submit review, or Attach works the
same way, and the shortcut targets the editor that has focus, or the composer
when none does. In the desktop browser's annotation editor, the microphone and
the shortcut work while the page has focus; the page you are annotating never
sees the recording, which runs in Fables itself.

**Dictation shortcut** in Voice settings picks how the keybinding behaves:
**Auto** tap-toggles or records while held, **Hold** records only while the keys
are down, and **Toggle** always needs a second press. Change the chord itself in
[Keybindings settings](./keybindings.md).

## Improve recognition

## Set up a local transcription model

In **Settings → Voice → Transcription**, filter by language, download a model, and select **Use model** (reuses matching files from Handy or the Hugging Face cache, or link an existing file via **Use existing**—Core ML/ONNX/MLX builds aren't supported).

- **Advanced**: Configure GPU/CPU (**Auto** falls back to CPU once on GPU error), idle unload timeout, and **Streaming transcription** (disable if live preview lags).

## Dictate and shortcuts

- Press the microphone button or `mod+shift+d` to start/stop (`Esc` discards; max recording length: **5 minutes**).
- Configure tap vs. hold behavior in **Settings → Voice → Dictation shortcut** (**Auto**, **Hold**, or **Toggle**), or remap the chord in [Keybindings](./keybindings.md).
- Pressing **Send** (or Save/Comment/Submit) while recording finishes transcription and submits automatically.

## Improve recognition and cleanup

- **Language & translation**: Pick a language or **Auto** (plus **Translate to English** where supported).
- **Personal & project dictionaries**: Add custom terms and common misspelling aliases in **Settings → Voice** (device-level) or scoped to a project/environment (up to 100 combined entries; project entries take priority).
- **Silence filtering & filler removal**: Skip silence (on by default) and strip hesitation words.
- **Transcript cleanup** (off by default): Sends the finished transcript and surrounding draft text (never audio) to your [text generation model](./text-generation.md) (or a dedicated **Cleanup model**) to fix punctuation, numbers, and spoken self-corrections (optionally using a custom **Correction cue** like "scratch that"). Press **Skip** during cleanup to insert raw text.

## Microphones and testing

- **Microphone priority**: Rank built-in, wired, Bluetooth, and CarPlay (iOS) devices in **Settings → Voice**—T3 Code uses the first connected device in the list.
- **Test**: Use **Test microphone** (local 10-second loopback, no transcription) to verify input, and **Test model** to preview raw transcription without cleanup.
- Browser recording requires **HTTPS** or `localhost`—for plain-HTTP remote servers, use the desktop app.
