import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('face_events')
export class FaceEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true }) personId?: string;
  @Column({ nullable: true }) personName?: string;

  @Column('float') confidence: number;
  @Column('float') quality: number;

  @Column({ nullable: true, type: 'float' }) spoofScore?: number;
  @Column({ default: false }) spoofDetected: boolean;
  @Column({ default: false }) occluded: boolean;

  @Column({ nullable: true, type: 'text' }) thumbnailBase64?: string;

  @Column({ nullable: true }) cameraId?: string;
  @Column({ nullable: true }) cameraName?: string;

  // Plate event from the same frame — links face to a vehicle pass
  @Column({ nullable: true }) detectionEventId?: string;

  @Column('float') x: number;
  @Column('float') y: number;
  @Column('float') width: number;
  @Column('float') height: number;

  @Index()
  @CreateDateColumn()
  timestamp: Date;
}
