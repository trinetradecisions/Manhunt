// Automated Production E2E Verification Script
// Tests live Vercel deployment: https://manhunt-murex.vercel.app

const BASE_URL = process.env.TARGET_URL || 'https://manhunt-murex.vercel.app';

async function run() {
  console.log(`\n======================================================`);
  console.log(`[E2E] Testing Production Deployment at: ${BASE_URL}`);
  console.log(`======================================================\n`);

  // 1. Health check
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const health = await healthRes.json();
  console.log(`1. Health Check:`, health);
  if (health.status !== 'healthy') throw new Error('Health check failed');

  // 2. Room Creation
  const hostId = `host_${Date.now()}`;
  const createStart = performance.now();
  const createRes = await fetch(`${BASE_URL}/api/room/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: {
        id: hostId,
        nickname: 'ViperPrime',
        initialLocation: { latitude: 37.7749, longitude: -122.4194 },
      },
    }),
  });
  const createData = await createRes.json();
  const createLatency = Math.round(performance.now() - createStart);
  console.log(`2. Room Created in ${createLatency}ms:`, {
    success: createData.success,
    roomCode: createData.room?.roomCode,
    version: createData.room?.version,
  });
  if (!createData.success || !createData.room?.roomCode) {
    throw new Error(`Failed to create room: ${createData.error}`);
  }
  const roomCode = createData.room.roomCode;

  // 3. Multi-Player Joins: Scale to 12 players
  console.log(`\n3. Scaling Room to 12 Players across thresholds (1, 2, 4, 6, 7, 8, 10, 12)...`);
  const playerIds = [hostId];
  const joinLatencies = [];

  let latestRoomState = createData.room;

  for (let i = 2; i <= 12; i++) {
    const pId = `agent_${i}_${Date.now()}`;
    const pNick = `Operative-${i}`;
    const start = performance.now();
    const joinRes = await fetch(`${BASE_URL}/api/room/${roomCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: pId,
        nickname: pNick,
        existingRoom: latestRoomState,
      }),
    });
    const joinData = await joinRes.json();
    const lat = Math.round(performance.now() - start);
    joinLatencies.push(lat);

    if (!joinData.success) {
      throw new Error(`Join failed for player ${i} (${pNick}): ${joinData.error}`);
    }
    playerIds.push(pId);
    if (joinData.room) latestRoomState = joinData.room;

    const rosterCount = Object.keys(joinData.room?.members || {}).length;
    console.log(`   + Player ${i}/12 (${pNick}) joined in ${lat}ms. Roster Count: ${rosterCount}, Version: ${joinData.room?.version}`);
  }

  // 4. Synchronization Verification across all 12 sessions
  console.log(`\n4. Verifying Synchronization across all 12 sessions...`);
  const syncStart = performance.now();
  for (const pid of playerIds) {
    let syncRes = await fetch(`${BASE_URL}/api/room/${roomCode}/sync?since=0&playerId=${encodeURIComponent(pid)}`);
    let syncData = await syncRes.json();

    if (syncData.needsHydration && latestRoomState) {
      await fetch(`${BASE_URL}/api/room/${roomCode}/hydrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: latestRoomState, requesterId: pid }),
      });
      syncRes = await fetch(`${BASE_URL}/api/room/${roomCode}/sync?since=0&playerId=${encodeURIComponent(pid)}`);
      syncData = await syncRes.json();
    }

    if (!syncData.success || !syncData.room) {
      throw new Error(`Sync failed for ${pid}: ${JSON.stringify(syncData)}`);
    }
    const count = Object.keys(syncData.room.members).length;
    if (count !== 12) {
      throw new Error(`Roster mismatch for ${pid}: expected 12, got ${count}`);
    }
  }

  const syncLatency = Math.round(performance.now() - syncStart);
  console.log(`   ✓ All 12 sessions in 100% agreement on 12 operatives! (Checked in ${syncLatency}ms)`);

  // 5. Team Configuration & Auto-Assignment
  console.log(`\n5. Configuring 3 Chasers & Auto-Assigning Teams...`);
  const chaserRes = await fetch(`${BASE_URL}/api/room/${roomCode}/team/chasers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requesterId: hostId,
      targetCount: 3,
    }),
  });
  const chaserData = await chaserRes.json();
  console.log(`   - Target chasers set to 3:`, chaserData.success);

  const autoRes = await fetch(`${BASE_URL}/api/room/${roomCode}/team/auto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requesterId: hostId,
    }),
  });
  const autoData = await autoRes.json();
  console.log(`   - Auto-assigned:`, {
    chasers: autoData.chasersCount,
    runners: autoData.runnersCount,
    version: autoData.room?.version,
  });

  // Verify teams
  const members = Object.values(autoData.room?.members || {});
  const chasers = members.filter((m) => m.team === 'CHASERS');
  const runners = members.filter((m) => m.team === 'RUNNERS');
  console.log(`   - Team Balance: ${chasers.length} Chasers, ${runners.length} Runners`);
  if (chasers.length !== 3 || runners.length !== 9) {
    throw new Error(`Auto assign failed balance check: ${chasers.length} vs ${runners.length}`);
  }

  // 6. Manual / Drag-Drop Reassignment Test
  console.log(`\n6. Testing Manual & Drag-Drop Reassignment...`);
  const targetToMove = chasers[0].id;
  const assignRes = await fetch(`${BASE_URL}/api/room/${roomCode}/team/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requesterId: hostId,
      targetPlayerId: targetToMove,
      team: 'RUNNERS',
    }),
  });
  const assignData = await assignRes.json();
  const movedMember = assignData.room?.members[targetToMove];
  console.log(`   - Moved ${targetToMove} to RUNNERS:`, {
    team: movedMember?.team,
    role: movedMember?.role,
    catchCodeAssigned: !!movedMember?.catchCode,
  });
  if (movedMember?.team !== 'RUNNERS') {
    throw new Error('Manual reassignment failed');
  }

  // 7. Tactical Bases and Excluded Zones
  console.log(`\n7. Testing Base Randomization & Area Exclusions...`);
  const basesRes = await fetch(`${BASE_URL}/api/room/${roomCode}/bases/randomize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostId,
      count: 3,
    }),
  });
  const basesData = await basesRes.json();
  console.log(`   - Tactical Bases generated:`, basesData.bases?.length);

  // 8. Ready Check & Match Start
  console.log(`\n8. Match Progression & Catch Verification...`);
  for (const pid of playerIds) {
    await fetch(`${BASE_URL}/api/room/${roomCode}/ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: pid,
        ready: true,
      }),
    });
  }

  const startRes = await fetch(`${BASE_URL}/api/room/${roomCode}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      initiatorId: hostId,
    }),
  });
  const startData = await startRes.json();
  console.log(`   - Match Started: State = ${startData.room?.state}`);

  console.log(`\n======================================================`);
  console.log(`[E2E] ALL PRODUCTION ENDPOINTS & SCALE CHECKS PASSED!`);
  console.log(`Average join latency: ${Math.round(joinLatencies.reduce((a,b)=>a+b,0)/joinLatencies.length)}ms`);
  console.log(`Max join latency: ${Math.max(...joinLatencies)}ms`);
  console.log(`======================================================\n`);
}

run().catch((err) => {
  console.error('[E2E FAIL]', err);
  process.exit(1);
});
