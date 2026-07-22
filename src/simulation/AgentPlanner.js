function scheduleForHour(schedule, hour) {
  return schedule.find((entry) => Number(String(entry.at ?? '').split(':')[0]) === hour) ?? null;
}

export class AgentPlanner {
  choose({ needs, schedule = [], worldTime, weather = 'clear', currentLocation, shelterLocation, companions = [] }) {
    if (weather === 'typhoon' || weather === 'storm') {
      return {
        type: 'shelter',
        location: shelterLocation ?? currentLocation,
        reason: `responding to ${weather}`,
      };
    }
    if (needs.energy < 25) return { type: 'sleep', location: currentLocation, reason: 'low energy' };
    if (needs.satiety < 30) return { type: 'eat', location: currentLocation, reason: 'hungry' };
    if (needs.social < 30 && companions.length > 0) {
      return { type: 'socialize', location: currentLocation, targetId: companions[0], reason: 'lonely' };
    }
    const scheduled = scheduleForHour(schedule, new Date(worldTime).getUTCHours());
    if (scheduled) {
      return {
        type: scheduled.action ?? 'work',
        location: scheduled.location ?? currentLocation,
        targetId: scheduled.targetId ?? null,
        reason: 'schedule',
      };
    }
    return { type: 'idle', location: currentLocation, reason: 'no urgent need' };
  }
}
