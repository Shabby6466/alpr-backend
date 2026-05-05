import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('detection_events')
export class DetectionEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  plateText: string;

  @Column('float')
  confidence: number;

  @Column({ nullable: true })
  personId?: string;

  @Column({ nullable: true })
  personName?: string;

  @Column({ default: 'image' })
  source: 'image' | 'video' | 'stream';

  @Column({ nullable: true, type: 'text' })
  thumbnailBase64?: string;

  @Column('float') x: number;
  @Column('float') y: number;
  @Column('float') width: number;
  @Column('float') height: number;

  @Index()
  @CreateDateColumn()
  timestamp: Date;
}
