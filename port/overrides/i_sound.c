// Web (Emscripten) override of i_sound.c: silent sound and music (v1).
#include <stdio.h>
#include <stdlib.h>

#include "doomdef.h"
#include "z_zone.h"
#include "w_wad.h"
#include "sounds.h"
#include "i_sound.h"

// Referenced by m_misc.c (SNDSERV externs); no sound server on the web.
FILE* sndserver = NULL;
char* sndserver_filename = "";

void I_SetChannels (void) {}

void I_SetSfxVolume (int volume) {}

void I_SetMusicVolume (int volume) {}

// Returns the lump number of the sound effect (keeps s_sound.c happy).
int I_GetSfxLumpNum (sfxinfo_t* sfx)
{
    char namebuf[9];
    sprintf (namebuf, "ds%s", sfx->name);
    return W_GetNumForName (namebuf);
}

int I_StartSound (int id, int vol, int sep, int pitch, int priority)
{
    static int handle = 0;
    handle = (handle % 7) + 1;
    return handle;
}

void I_StopSound (int handle) {}

int I_SoundIsPlaying (int handle)
{
    return 0;
}

void I_UpdateSoundParams (int handle, int vol, int sep, int pitch) {}

void I_InitSound (void) {}

void I_UpdateSound (void) {}

void I_SubmitSound (void) {}

void I_ShutdownSound (void) {}

void I_InitMusic (void) {}

void I_ShutdownMusic (void) {}

int I_RegisterSong (void* data)
{
    return 1;
}

void I_PlaySong (int handle, int looping) {}

void I_PauseSong (int handle) {}

void I_ResumeSong (int handle) {}

void I_StopSong (int handle) {}

void I_UnRegisterSong (int handle) {}

int I_QrySongPlaying (int handle)
{
    return 0;
}
