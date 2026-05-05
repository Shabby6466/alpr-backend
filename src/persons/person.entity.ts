import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { Exclude } from 'class-transformer';

@Entity('persons')
export class Person {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column('simple-json')
  plateNumbers: string[];

  @Column({ nullable: true })
  notes?: string;

  @Exclude({ toPlainOnly: true })
  @Column({ type: 'blob', nullable: true })
  faceTemplate?: Buffer;

  @Column({ nullable: true })
  faceThumbnail?: string;

  @CreateDateColumn()
  createdAt: Date;
}
