import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('cameras')
export class Camera {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column() name: string;
  @Column() url: string;

  @Column({ default: 'NORTH_AMERICAN' })
  region: string;

  @Column({ default: 5 })
  frameStep: number;

  @Column({ default: true })
  active: boolean;

  @Column({ nullable: true })
  notes?: string;

  @Column({ nullable: true })
  zone?: string;

  @Column({ nullable: true, type: 'real' })
  lat?: number;

  @Column({ nullable: true, type: 'real' })
  lng?: number;

  // ROI zones — stored as JSON arrays of {x,y,width,height} objects (pixel or normalized coords)
  @Column({ type: 'simple-json', nullable: true })
  roiInclude?: { x: number; y: number; width: number; height: number }[];

  @Column({ type: 'simple-json', nullable: true })
  roiExclude?: { x: number; y: number; width: number; height: number }[];

  @CreateDateColumn()
  createdAt: Date;
}
