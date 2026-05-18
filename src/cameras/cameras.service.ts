import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Camera } from './camera.entity';
import { CreateCameraDto, UpdateCameraDto } from './dto/camera.dto';

@Injectable()
export class CamerasService {
  constructor(
    @InjectRepository(Camera)
    private readonly repo: Repository<Camera>,
  ) {}

  create(dto: CreateCameraDto): Promise<Camera> {
    return this.repo.save(this.repo.create(dto));
  }

  findAll(): Promise<Camera[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  findActive(): Promise<Camera[]> {
    return this.repo.find({ where: { active: true }, order: { createdAt: 'ASC' } });
  }

  async findOne(id: string): Promise<Camera> {
    const camera = await this.repo.findOne({ where: { id } });
    if (!camera) throw new NotFoundException(`Camera ${id} not found`);
    return camera;
  }

  async update(id: string, dto: UpdateCameraDto): Promise<Camera> {
    const camera = await this.findOne(id);
    Object.assign(camera, dto);
    return this.repo.save(camera);
  }

  async remove(id: string): Promise<void> {
    const camera = await this.findOne(id);
    await this.repo.remove(camera);
  }
}
