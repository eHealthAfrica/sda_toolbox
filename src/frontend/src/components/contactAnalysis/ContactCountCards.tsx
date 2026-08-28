import type { ContactCountEntry } from '../../utils/contactAggregate'
import { getContactCountColor } from '../../utils/colors'
import StatCard from '../common/StatCard'

interface ContactCountCardsProps {
  counts: ContactCountEntry[]
  maxContact: number
  averageContactProportion: number | null
}

function contactLabel(contact: number): string {
  return `${contact} round${contact === 1 ? '' : 's'}`
}

// One card per distinct `contact` value actually observed (how many of the
// compared rounds a settlement was 'Visited' in), colored on the same
// continuous good/critical ramp as the map below — see
// utils/colors.ts::getContactCountColor. The average contact_proportion
// card sits alongside as a quick companion figure — see
// utils/contactAggregate.ts::computeAverageContactProportion's comment on
// why it can read lower than a settlement's raw contact count would imply.
export default function ContactCountCards({ counts, maxContact, averageContactProportion }: ContactCountCardsProps) {
  const total = counts.reduce((sum, c) => sum + c.count, 0)

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Contact — rounds each settlement was reached in</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {counts.map(({ contact, count }) => (
          <StatCard
            key={contact}
            label={contactLabel(contact)}
            value={count.toLocaleString()}
            accentColor={getContactCountColor(contact, maxContact)}
            hint={total > 0 ? `${((count / total) * 100).toFixed(1)}% of settlements` : undefined}
          />
        ))}
        {averageContactProportion !== null && (
          <StatCard
            label="Average contact proportion"
            value={`${(averageContactProportion * 100).toFixed(1)}%`}
            accentColor="#2c5f9e"
            hint="of each settlement's own eligible rounds"
          />
        )}
      </div>
    </section>
  )
}
