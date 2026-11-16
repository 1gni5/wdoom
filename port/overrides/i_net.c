// Web (Emscripten) override of i_net.c.
//
// Single player (no doom_net_config call): single-player doomcom, as before.
// Multiplayer: packets are exchanged with JS (WebSocket relay), see
// docs/multiplayer.md. JS-visible node ids are PLAYER indices (0..n-1).
// Doom's internal node numbering has the local machine as node 0 and the
// remote players as nodes 1.. in ascending player order; we translate here.
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#include "doomdef.h"
#include "i_system.h"
#include "d_event.h"
#include "d_net.h"
#include "m_argv.h"
#include "doomstat.h"
#include "d_player.h"
#include "p_mobj.h"
#include "i_net.h"

int DOOMPORT = 0;

void (*netget) (void);
void (*netsend) (void);

// ---- configuration (doom_net_config) ----
static int cfg_set = 0;
static int cfg_numplayers, cfg_console, cfg_deathmatch, cfg_skill,
           cfg_episode, cfg_map;

void doom_net_config (int numplayers, int consoleplayer, int deathmatch,
                      int skill, int episode, int map)
{
    cfg_numplayers = numplayers;
    cfg_console = consoleplayer;
    cfg_deathmatch = deathmatch;
    cfg_skill = skill;     // 1..5 (as in "-skill"), converted below
    cfg_episode = episode;
    cfg_map = map;
    cfg_set = (numplayers >= 2 && numplayers <= MAXPLAYERS
               && consoleplayer >= 0 && consoleplayer < numplayers);
}

// ---- JS -> C receive queue ----
#define PKT_MAX   256
#define QSIZE     128

typedef struct { int player; int len; uint8_t data[PKT_MAX]; } qpkt_t;
static qpkt_t queue[QSIZE];
static int qhead = 0, qtail = 0;   // pop at head, push at tail

static uint8_t scratch[PKT_MAX];

uint8_t* doom_net_buffer (void)
{
    return scratch;
}

// Called by JS with a packet received from player `node`. Packet bytes are
// at ptr (normally doom_net_buffer()). Returns 1 if queued, 0 if dropped.
int doom_net_push (int node, uint8_t* ptr, int len)
{
    int next = (qtail + 1) % QSIZE;
    if (len <= 0 || len > PKT_MAX || next == qhead)
        return 0;   // full: drop (Doom's retransmit logic recovers)
    queue[qtail].player = node;
    queue[qtail].len = len;
    memcpy (queue[qtail].data, ptr, len);
    qtail = next;
    return 1;
}

// ---- node <-> player mapping ----
static int player_of_node[MAXNETNODES];
static int node_of_player[MAXNETNODES];

extern void web_net_send (int player, const uint8_t* ptr, int len);

static void WebNetSend (void)
{
    int node = doomcom->remotenode;
    if (node <= 0 || node >= doomcom->numnodes)
        return;
    web_net_send (player_of_node[node], (const uint8_t*) &doomcom->data,
                  doomcom->datalength);
}

static void WebNetGet (void)
{
    doomcom->remotenode = -1;
    while (qhead != qtail)
    {
        qpkt_t* p = &queue[qhead];
        int node = (p->player >= 0 && p->player < MAXNETNODES)
                   ? node_of_player[p->player] : -1;
        int len = p->len;
        qhead = (qhead + 1) % QSIZE;
        if (node <= 0 || len > (int) sizeof (doomdata_t))
            continue;   // unknown sender / self / oversize
        memcpy (&doomcom->data, p->data, len);
        doomcom->remotenode = node;
        doomcom->datalength = len;
        return;
    }
}

void I_InitNetwork (void)
{
    int i, node;

    doomcom = malloc (sizeof (*doomcom));
    memset (doomcom, 0, sizeof (*doomcom));

    doomcom->ticdup = 1;
    doomcom->extratics = 0;
    doomcom->id = DOOMCOM_ID;
    doomcom->numplayers = doomcom->numnodes = 1;
    doomcom->deathmatch = false;
    doomcom->consoleplayer = 0;
    doomcom->savegame = -1;
    netgame = false;

    if (!cfg_set)
        return;

    netsend = WebNetSend;
    netget = WebNetGet;
    qhead = qtail = 0;

    doomcom->numplayers = doomcom->numnodes = cfg_numplayers;
    doomcom->consoleplayer = cfg_console;
    doomcom->extratics = 1;
    doomcom->deathmatch = cfg_deathmatch;
    doomcom->episode = cfg_episode;
    doomcom->map = cfg_map;
    doomcom->skill = cfg_skill;

    for (i = 0; i < MAXNETNODES; i++)
        player_of_node[i] = node_of_player[i] = -1;
    player_of_node[0] = cfg_console;
    node_of_player[cfg_console] = 0;
    node = 1;
    for (i = 0; i < cfg_numplayers; i++)
    {
        if (i == cfg_console)
            continue;
        player_of_node[node] = i;
        node_of_player[i] = node;
        node++;
    }

    // Game parameters (normally agreed in D_ArbitrateNetStart, which is
    // skipped in the web build since the lobby already agreed on them).
    startskill = cfg_skill - 1;
    if (startskill < 0) startskill = 0;
    if (startskill > 4) startskill = 4;
    startepisode = cfg_episode;
    startmap = cfg_map;
    deathmatch = cfg_deathmatch;
    autostart = true;

    netgame = true;
}

void I_NetCmd (void)
{
    if (doomcom->command == CMD_SEND)
    {
        if (netsend) netsend ();
    }
    else if (doomcom->command == CMD_GET)
    {
        if (netget) netget (); else doomcom->remotenode = -1;
    }
    else
        I_Error ("Bad net cmd: %i\n", doomcom->command);
}

// ---- debugging helpers ----

// Checksum over player state (position, angle, health) for desync detection.
unsigned doom_net_checksum (void)
{
    unsigned h = 2166136261u;
    int i;
    for (i = 0; i < MAXPLAYERS; i++)
    {
        unsigned v[5];
        int k;
        if (!playeringame[i] || !players[i].mo)
            continue;
        v[0] = players[i].mo->x;
        v[1] = players[i].mo->y;
        v[2] = players[i].mo->z;
        v[3] = players[i].mo->angle;
        v[4] = players[i].health;
        for (k = 0; k < 5; k++)
        {
            h ^= v[k];
            h *= 16777619u;
        }
    }
    return h;
}

int doom_net_gametic (void)
{
    return gametic;
}
