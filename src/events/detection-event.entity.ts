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
  source: 'image' | 'video' | 'stream' | 'camera';

  @Column({ nullable: true, type: 'text' })
  thumbnailBase64?: string;

  @Column('float') x: number;
  @Column('float') y: number;
  @Column('float') width: number;
  @Column('float') height: number;

  // Vehicle metadata from roc_represent_object_ex
  @Column({ nullable: true }) vehicleMake?: string;
  @Column({ nullable: true }) vehicleModel?: string;
  @Column({ nullable: true }) vehicleColor?: string;
  @Column({ nullable: true, type: 'text' }) vehicleThumbnail?: string;

  // Direction of travel derived from multi-frame centroid tracking
  @Column({ nullable: true })
  direction?: 'left' | 'right' | 'stationary';

  // Camera that produced this event (null for one-shot API calls)
  @Column({ nullable: true }) cameraId?: string;
  @Column({ nullable: true }) cameraName?: string;

  // True when a gun was detected in the same frame as this plate
  @Column({ default: false })
  gunDetected: boolean;

  @Index()
  @CreateDateColumn()
  timestamp: Date;
}
