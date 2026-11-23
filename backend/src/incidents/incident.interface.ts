/**
 * Domain model representing a reported incident.
 */
export interface Incident {
  id: string;
  title: string;
  description: string;
  type: string;
  zone: string;
  createdAt: string;
}
