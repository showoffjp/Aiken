// What each concept page does for a customer beyond looking good: listed on
// the checkup and in the concept's "What changed?" notes. Only the features
// that apply to the business are named (no "Open now" without known hours).
import type { Demo } from './demos';
import { openingHours } from './schema';

export function builtIn(demo: Demo): string[] {
  const { contact } = demo;
  const photos = demo.sections.some((s) => s.type === 'gallery' || (s.type === 'story' && s.image));
  return [
    openingHours(contact.hours) && 'A live "Open now" sign that checks the clock in Aiken and says when you open next',
    contact.phone && 'Tap-to-call buttons everywhere, plus a call bar that stays at hand on phones',
    contact.mapQuery && 'Directions that open Google Maps, or Apple Maps on an iPhone',
    'Save to contacts: name, number, address and hours go straight into a customer\'s phone',
    photos && 'Photos open full screen, with swipe on phones and arrow keys on computers',
    'A share button for texting the page to a friend, and a phone menu with big, easy buttons',
    contact.phone && 'On a computer: a code to scan that opens the page on a phone, and one-click copy of the number and address',
  ].filter(Boolean) as string[];
}
