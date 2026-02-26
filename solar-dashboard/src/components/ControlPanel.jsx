import { useMemo } from 'react';

const MODE_LABELS = {
  full_production: 'Volledige productie',
  self_consumption: 'Eigenverbruik',
  no_negative_prices: 'Geen negatieve prijzen',
};

const MODE_OPTIONS = [
  { value: 'full_production', label: 'Volledige productie', desc: 'Omvormer draait altijd op maximaal vermogen' },
  { value: 'self_consumption', label: 'Eigenverbruik', desc: 'Beperk productie tot eigen verbruik, geen teruglevering' },
  { value: 'no_negative_prices', label: 'Geen neg. prijzen', desc: 'Volledige productie bij positieve prijs, eigenverbruik bij negatieve prijs' },
];

const SCHEDULE_COLORS = {
  full_production: '#66BB6A',
  self_consumption: '#FFA726',
  off: '#EF5350',
  limited: '#42A5F5',
};

const SCHEDULE_LABELS = {
  full_production: 'Volledige productie',
  self_consumption: 'Eigenverbruik',
  off: 'Uit',
  limited: 'Beperkt',
};

function formatTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function formatDayShort(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

// Group consecutive schedule slots with same action into segments
function groupSegments(schedule) {
  if (!schedule || !schedule.length) return [];

  const segments = [];
  let current = {
    action: schedule[0].recommended_action,
    startTime: new Date(schedule[0].timestamp).getTime(),
    endTime: new Date(schedule[0].timestamp).getTime(),
    count: 1,
    slots: [schedule[0]],
  };

  for (let i = 1; i < schedule.length; i++) {
    const slot = schedule[i];
    const action = slot.recommended_action;
    if (action === current.action) {
      current.endTime = new Date(slot.timestamp).getTime();
      current.count++;
      current.slots.push(slot);
    } else {
      segments.push(current);
      current = {
        action,
        startTime: new Date(slot.timestamp).getTime(),
        endTime: new Date(slot.timestamp).getTime(),
        count: 1,
        slots: [slot],
      };
    }
  }
  segments.push(current);
  return segments;
}

function ScheduleTimeline({ schedule }) {
  const segments = useMemo(() => groupSegments(schedule), [schedule]);

  if (!segments.length) return null;

  const startTime = segments[0].startTime;
  const slotDuration = 15 * 60 * 1000;
  const endTime = segments[segments.length - 1].endTime + slotDuration;
  const totalTime = endTime - startTime;

  if (totalTime <= 0) return null;

  // Day boundary ticks
  const ticks = [];
  const firstDay = new Date(startTime);
  firstDay.setHours(0, 0, 0, 0);
  let tickTime = firstDay.getTime() + 24 * 60 * 60 * 1000;
  while (tickTime < endTime) {
    ticks.push({ time: tickTime, label: formatDayShort(tickTime) });
    tickTime += 24 * 60 * 60 * 1000;
  }

  // "Now" marker
  const now = Date.now();
  const nowPct = now >= startTime && now <= endTime
    ? ((now - startTime) / totalTime) * 100
    : null;

  // Unique actions for legend
  const uniqueActions = [...new Set(segments.map((s) => s.action))];

  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>
        Inverter Schedule
      </div>

      {/* Timeline bar */}
      <div style={{
        display: 'flex', height: '28px', borderRadius: '4px',
        overflow: 'hidden', border: '1px solid #e5e7eb', position: 'relative',
      }}>
        {segments.map((seg, i) => {
          const width = ((seg.endTime - seg.startTime + slotDuration) / totalTime) * 100;
          const color = SCHEDULE_COLORS[seg.action] || '#9ca3af';
          return (
            <div
              key={i}
              title={`${SCHEDULE_LABELS[seg.action] || seg.action} (${seg.count} slots, ${formatTime(seg.startTime)} - ${formatTime(seg.endTime + slotDuration)})`}
              style={{
                width: `${width}%`,
                height: '100%',
                backgroundColor: color,
                minWidth: '1px',
                opacity: 0.85,
              }}
            />
          );
        })}

        {/* "Now" marker */}
        {nowPct !== null && (
          <div style={{
            position: 'absolute', left: `${nowPct}%`,
            top: 0, bottom: 0, width: '2px',
            backgroundColor: '#333', zIndex: 1,
          }}>
            <span style={{
              position: 'absolute', top: '-16px', left: '-8px',
              fontSize: '10px', color: '#333', fontWeight: 600,
            }}>
              Nu
            </span>
          </div>
        )}
      </div>

      {/* Tick labels */}
      <div style={{ position: 'relative', height: '18px', marginTop: '2px' }}>
        {ticks.map((tick) => {
          const pct = ((tick.time - startTime) / totalTime) * 100;
          return (
            <span key={tick.time} style={{
              position: 'absolute', fontSize: '10px', color: '#9ca3af',
              transform: 'translateX(-50%)', left: `${pct}%`,
            }}>
              {tick.label}
            </span>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '4px' }}>
        {uniqueActions.map((action) => (
          <span key={action} style={{ display: 'flex', alignItems: 'center', fontSize: '11px', color: '#6b7280' }}>
            <span style={{
              display: 'inline-block', width: '10px', height: '10px',
              borderRadius: '2px', backgroundColor: SCHEDULE_COLORS[action] || '#9ca3af',
              marginRight: '4px',
            }} />
            {SCHEDULE_LABELS[action] || action}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ControlPanel({ hass, entities, colors }) {
  // Find all inverter mode select entities and status sensors
  const inverters = useMemo(() => {
    if (!hass?.states) return [];
    return Object.keys(hass.states)
      .filter((id) => id.startsWith('select.sp_inverter_mode_'))
      .map((selectId) => {
        const inverterId = selectId.replace('select.sp_inverter_mode_', '');
        const statusId = `sensor.sp_inverter_${inverterId}_status`;
        const selectState = hass.states[selectId];
        const statusState = hass.states[statusId];
        return {
          id: inverterId,
          selectId,
          statusId,
          name: selectState?.attributes?.friendly_name?.replace(' Mode', '') || inverterId,
          currentMode: selectState?.state || 'full_production',
          options: selectState?.attributes?.options || ['full_production', 'self_consumption', 'no_negative_prices'],
          status: statusState?.state || '—',
          power: statusState?.attributes?.power_w,
          ratedPower: statusState?.attributes?.rated_power_w,
          lastAction: statusState?.attributes?.last_action,
          lastReason: statusState?.attributes?.last_action_reason,
          mode: statusState?.attributes?.mode,
        };
      });
  }, [hass]);

  // Get schedule from schedule sensor
  const schedule = useMemo(() => {
    if (!hass?.states) return [];
    const scheduleEntity = hass.states['sensor.sp_inverter_schedule'];
    return scheduleEntity?.attributes?.schedule || [];
  }, [hass]);

  // Get current selling price
  const sellingPrice = useMemo(() => {
    if (!hass?.states?.[entities.sellingPrice]) return null;
    const state = hass.states[entities.sellingPrice];
    const val = parseFloat(state.state);
    return !isNaN(val) ? val : null;
  }, [hass, entities.sellingPrice]);

  const handleModeChange = (selectId, mode) => {
    if (!hass?.callService) return;
    hass.callService('select', 'select_option', {
      entity_id: selectId,
      option: mode,
    });
  };

  return (
    <div>
      {/* Price indicator */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '12px 16px', borderRadius: '8px', marginBottom: '16px',
        background: sellingPrice != null && sellingPrice < 0 ? '#FEF2F2' : '#F0FDF4',
        border: `1px solid ${sellingPrice != null && sellingPrice < 0 ? '#FECACA' : '#BBF7D0'}`,
      }}>
        <div style={{
          width: '10px', height: '10px', borderRadius: '50%',
          backgroundColor: sellingPrice != null && sellingPrice < 0 ? colors.warning : colors.selfConsumed,
        }} />
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: colors.text }}>
            Verkoopprijs: {sellingPrice != null ? `€${(sellingPrice * 100).toFixed(1)} c/kWh` : '—'}
          </div>
          <div style={{ fontSize: '11px', color: colors.textLight }}>
            {sellingPrice != null && sellingPrice < 0
              ? 'Negatieve prijs gedetecteerd — omvormers in no_negative_prices modus beperken teruglevering'
              : 'Positieve prijs — volledige productie is optimaal'}
          </div>
        </div>
      </div>

      {/* Schedule Timeline */}
      {schedule.length > 0 && <ScheduleTimeline schedule={schedule} />}

      {/* Per-inverter control cards */}
      {inverters.length === 0 ? (
        <div style={{ color: '#9ca3af', textAlign: 'center', marginTop: '40px' }}>
          Geen omvormers geconfigureerd
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {inverters.map((inv) => (
            <div key={inv.id} style={{
              padding: '20px', borderRadius: '10px',
              background: '#fff', border: `1px solid ${colors.border}`,
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text }}>{inv.name}</div>
                  <div style={{ fontSize: '12px', color: colors.textLight }}>
                    {inv.ratedPower ? `${inv.ratedPower} W nominaal` : ''}
                  </div>
                </div>
                <div style={{
                  padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                  backgroundColor: inv.status === 'on' ? '#DCFCE7' : inv.status === 'limited' ? '#FEF3C7' : '#FEE2E2',
                  color: inv.status === 'on' ? '#166534' : inv.status === 'limited' ? '#92400E' : '#991B1B',
                }}>
                  {inv.status === 'on' ? 'Aan' : inv.status === 'limited' ? 'Beperkt' : inv.status === 'off' ? 'Uit' : inv.status}
                </div>
              </div>

              {/* Current power */}
              <div style={{ display: 'flex', gap: '24px', marginBottom: '16px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: colors.textLight }}>Huidig vermogen</div>
                  <div style={{ fontSize: '24px', fontWeight: 600, color: colors.solar }}>
                    {inv.power != null ? `${Math.round(inv.power)} W` : '—'}
                  </div>
                </div>
                {inv.ratedPower > 0 && inv.power != null && (
                  <div>
                    <div style={{ fontSize: '11px', color: colors.textLight }}>Capaciteit</div>
                    <div style={{ fontSize: '24px', fontWeight: 600, color: colors.textLight }}>
                      {((inv.power / inv.ratedPower) * 100).toFixed(0)}%
                    </div>
                  </div>
                )}
              </div>

              {/* Mode selector */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', color: colors.textLight, marginBottom: '6px' }}>Modus</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {MODE_OPTIONS.filter((opt) => inv.options.includes(opt.value)).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleModeChange(inv.selectId, opt.value)}
                      title={opt.desc}
                      style={{
                        padding: '8px 14px', borderRadius: '6px',
                        border: `1px solid ${inv.currentMode === opt.value ? colors.solar : colors.border}`,
                        background: inv.currentMode === opt.value ? colors.solar : '#fff',
                        color: inv.currentMode === opt.value ? '#1a1a1a' : colors.textLight,
                        fontWeight: inv.currentMode === opt.value ? 600 : 400,
                        cursor: 'pointer', fontSize: '12px',
                        transition: 'all 0.15s',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Last action */}
              {inv.lastAction && (
                <div style={{
                  padding: '8px 12px', borderRadius: '6px',
                  background: colors.bg, fontSize: '12px',
                }}>
                  <span style={{ color: colors.textLight }}>Laatste actie: </span>
                  <span style={{ color: colors.text, fontWeight: 500 }}>{inv.lastAction}</span>
                  {inv.lastReason && (
                    <div style={{ color: colors.textLight, marginTop: '2px', fontSize: '11px' }}>
                      {inv.lastReason}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
