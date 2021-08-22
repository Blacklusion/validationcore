import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToOne, JoinColumn } from "typeorm";
import { HttpErrorType } from "../enum/HttpErrorType";
import { ValidationLevel } from "../enum/ValidationLevel";

/**
 * Stores the validation results of an NodeApi validation
 * An NodeApi validation contains a relation to a potential history validation
 */
@Entity()
export class NodeAtomic {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ length: 12 })
  guild: string;

  @CreateDateColumn()
  validation_date: Date;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.ERROR })
  all_checks_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  location_ok: ValidationLevel;

  @Column({ nullable: false })
  endpoint_url: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  endpoint_url_ok: ValidationLevel;

  @Column({ default: false })
  is_ssl: boolean;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  ssl_ok: ValidationLevel;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  ssl_errortype: HttpErrorType;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_found: ValidationLevel;

  @Column({ nullable: true })
  health_ms: number;

  @Column({ nullable: true })
  health_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  health_errortype: HttpErrorType;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_postgres_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_redis_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_chain_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_total_indexed_blocks_ok: ValidationLevel;

  @Column({ nullable: true })
  health_missing_blocks: number;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  alive_ok: ValidationLevel;

  @Column({ nullable: true })
  alive_message: string;

  @Column({ nullable: true })
  alive_ms: number;

  @Column({ nullable: true })
  alive_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  alive_errortype: HttpErrorType;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  assets_ok: ValidationLevel;

  @Column({ nullable: true })
  assets_ms: number;

  @Column({ nullable: true })
  assets_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  assets_errortype: HttpErrorType;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  collections_ok: ValidationLevel;

  @Column({ nullable: true })
  collections_ms: number;

  @Column({ nullable: true })
  collections_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  collections_errortype: HttpErrorType;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  schemas_ok: ValidationLevel;

  @Column({ nullable: true })
  schemas_ms: number;

  @Column({ nullable: true })
  schemas_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  schemas_errortype: HttpErrorType;
}
