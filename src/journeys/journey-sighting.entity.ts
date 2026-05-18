import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Journey } from './journey.entity';

@Entity('journey_sightings')
export class JourneySighting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Journey, j => j.sightings, { onDelete: 'CASCADE' })
  @JoinColumn()
  journey: Journey;

  @Column({ nullable: true }) cameraId?: string;
  @Column({ nullable: true }) cameraName?: string;
  @Column({ nullable: true }) zone?: string;
  @Column({ nullable: true, type: 'real' }) lat?: number;
  @Column({ nullable: true, type: 'real' }) lng?: number;

  @Index()
  @Column()
  seenAt: Date;

  @Column({ nullable: true, type: 'text' }) thumbnailBase64?: string;
  @Column({ type: 'real' }) confidence: number;
  @Column({ nullable: true }) detectionEventId?: string;
}
