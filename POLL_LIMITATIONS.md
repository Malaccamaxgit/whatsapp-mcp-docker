# Poll Vote Tracking Limitations

## ⚠️ Important Notice

The WhatsApp MCP Docker server has **limited poll vote tracking capabilities** due to WhatsApp's multidevice protocol restrictions.

## What Works ✅

- **Creating polls**: You can create polls with the `create_poll` tool
- **Poll persistence**: Poll creation messages are stored in the database
- **Short name registration**: Polls can be labeled with short names for easy reference
- **Basic poll structure**: Question and options are stored correctly

## What Doesn't Work ❌

- **Real-time vote tracking**: Votes cast by participants may not appear in poll results
- **Historical vote sync**: Votes cast before server startup won't be retrieved
- **Complete vote counts**: Results shown may be incomplete or show 0 votes

## Technical Explanation

### WhatsApp's Event-Driven Architecture

WhatsApp's multidevice protocol uses an **event-driven model** for poll votes:

1. **Primary Device** (your phone): Receives all poll vote updates in real-time
2. **Secondary Devices** (MCP server): May not receive `poll_update_message` events

The whatsmeow-node library (and underlying Go whatsmeow library) provides:
- ✅ `sendPollCreation()` - Create polls
- ✅ `BuildPollVote()` - Send votes  
- ✅ `DecryptPollVote()` - Decrypt incoming vote updates
- ❌ **NO `GetPollVotes()` or `QueryPoll()` method** to actively fetch votes

### Why Votes Don't Sync

WhatsApp's servers may not forward poll vote events to secondary devices because:

1. **Device Hierarchy**: Your phone is the primary device; MCP server is secondary
2. **Event Filtering**: WhatsApp filters which events are sent to companion devices
3. **No Active Query**: Cannot request current poll state on-demand
4. **Protocol Limitation**: This is a WhatsApp design decision, not a bug

## Implementation Details

### What the Server Does

The server includes infrastructure for poll vote tracking:

```typescript
// Client receives poll update messages
if (rawMessage?.pollUpdateMessage || rawMessage?.protocolMessage?.pollUpdateMessage) {
  const pollUpdate = rawMessage.pollUpdateMessage || rawMessage.protocolMessage?.pollUpdateMessage;
  
  // Extract vote data
  const voteOptions = pollUpdate.vote?.selectedOptions || 
                     (pollUpdate.vote?.selectedOption ? [pollUpdate.vote.selectedOption] : []);
  
  // Store in database
  messageStore.addPollVote({
    pollMessageId: pollUpdate.pollCreationMessageKey.id,
    voterJid: msg.senderJid,
    voterName: msg.senderName,
    voteOptions: voteOptions,
    timestamp: msg.timestamp,
    chatJid: msg.chatJid
  });
}
```

### Enhanced Logging

The server logs poll-related events with `[WA-POLL]` prefix:

```
[WA-POLL] 🗳️  Poll update message detected!
[WA-POLL] Vote captured: { pollId, voter, options, chatJid }
[WA-POLL] 💾 Vote stored in database successfully
```

To monitor: `docker compose logs -f whatsapp-mcp-docker | Select-String "WA-POLL"`

## User Guidance

### For Poll Creators

1. **Create polls** using the `create_poll` tool - this works fully
2. **Use short names** to easily reference polls later
3. **Check WhatsApp directly** for accurate, real-time vote counts
4. **Don't rely on `get_poll_results`** for critical vote tracking

### For MCP Clients/AI Assistants

When users ask about poll results:

```
⚠️ Note: I can see the poll was created, but WhatsApp doesn't sync vote 
results to secondary devices in real-time. For accurate vote counts, 
please check the poll directly in your WhatsApp app.

The poll structure (question and options) is available, but vote tracking 
is limited by WhatsApp's multidevice protocol.
```

### Best Practices

1. **Use polls for engagement**, not critical voting
2. **Monitor in WhatsApp app** for live results
3. **Server must be running** when votes are cast to have any chance of receiving them
4. **Expect incomplete data** - even with the server running continuously

## Research Findings

### whatsmeow-node API Analysis

The library provides these poll-related methods:

| Method | Purpose | Available |
|--------|---------|-----------|
| `sendPollCreation()` | Create polls | ✅ Yes |
| `BuildPollVote()` | Send votes | ✅ Yes |
| `DecryptPollVote()` | Decrypt received votes | ✅ Yes |
| `HashPollOptions()` | Hash option names | ✅ Yes |
| **`GetPollVotes()`** | **Query existing votes** | ❌ **NO** |
| **`QueryPoll()`** | **Fetch poll state** | ❌ **NO** |

### WhatsApp Protocol Behavior

- Poll votes are sent as `poll_update_message` events
- Events are encrypted and must be decrypted with `DecryptPollVote()`
- Secondary devices may not receive these events
- No mechanism to request historical poll data

## Alternative Approaches (Not Implemented)

These workarounds were considered but rejected:

1. **Force History Re-sync**: Disconnect/reconnect to trigger sync
   - ❌ Too disruptive, unreliable, may not include votes

2. **Send Test Vote**: Cast and retract a vote to trigger poll state sync
   - ❌ Destructive, confusing to users, may not work

3. **Continuous Listening**: Keep server running to catch votes in real-time
   - ⚠️ Partial solution - still depends on WhatsApp sending events

## Conclusion

**Poll creation works fully, but vote tracking is fundamentally limited by WhatsApp's protocol.**

The server implements all available infrastructure for receiving votes, but WhatsApp's multidevice architecture doesn't guarantee that vote updates will be forwarded to secondary devices.

**Recommendation**: Use polls for engagement and fun, but check the WhatsApp app directly for accurate vote counts.

---

**References:**
- [whatsmeow Go Library Documentation](https://pkg.go.dev/go.mau.fi/whatsmeow)
- [whatsmeow-node TypeScript Bindings](https://github.com/vinikjkkj/whatsmeow-node)
- [WhatsApp Multidevice Protocol](https://github.com/tulir/whatsmeow)

**Last Updated**: 2026-04-07
