import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";
import { ValidationLevel } from "../enum/ValidationLevel";

/**
 * Stores the validation results of an seed / p2p validation
 */
@Entity()
export class NodeSeed {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "smallint", nullable: false })
  instance_id: number;

  @Column({ length: 12 })
  guild: string;

  @CreateDateColumn()
  validation_date: Date;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  all_checks_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  location_ok: ValidationLevel;

  @Column({ type: "decimal", precision: 9, scale: 6, nullable: true })
  location_longitude: number;

  @Column({ type: "decimal", precision: 8, scale: 6,  nullable: true })
  location_latitude: number;

  @Column({ nullable: false })
  endpoint_url: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  endpoint_url_ok: ValidationLevel;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  p2p_connection_possible: ValidationLevel;

  @Column({ nullable: true })
  p2p_connection_possible_message: string;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  block_transmission_speed_ok: ValidationLevel;

  @Column({ type: "bigint", nullable: true })
  block_transmission_speed_ms: number;
}
