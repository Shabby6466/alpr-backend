import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('alerts')
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  plateText: string;

  @Column()
  watchlistEntryId: string;

  @Column({ nullable: true })
  detectionEventId?: string;

  @Column({ nullable: true })
  reason?: string;

  @Column({ nullable: true, type: 'text' })
  thumbnailBase64?: string;

  @Column({ default: false })
  acknowledged: boolean;

  @Index()
  @CreateDateColumn()
  timestamp: Date;
}
