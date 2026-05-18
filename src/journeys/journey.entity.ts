import { Entity, PrimaryGeneratedColumn, Column, Index, OneToMany, CreateDateColumn } from 'typeorm';
import { JourneySighting } from './journey-sighting.entity';

@Entity('journeys')
export class Journey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  plateText: string;

  @Column({ default: 'active' })
  status: 'active' | 'closed';

  @Column()
  startedAt: Date;

  @Index()
  @Column()
  lastSeenAt: Date;

  @OneToMany(() => JourneySighting, s => s.journey, { cascade: ['insert'] })
  sightings: JourneySighting[];
}
