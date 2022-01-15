import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";
import { HttpErrorType } from "../enum/HttpErrorType";
import { ValidationLevel } from "../enum/ValidationLevel";

/**
 * Stores the validation results of an NodeWallet validation
 */
@Entity()
export class NodeWallet {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "smallint", nullable: false })
  instance_id: number;

  @Column({ length: 12 })
  guild: string;

  @CreateDateColumn()
  validation_date: Date;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.ERROR })
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



  @Column({ default: false })
  is_ssl: boolean;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  ssl_ok: ValidationLevel;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  ssl_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  accounts_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  accounts_ms: number;

  @Column({ type: "smallint", nullable: true })
  accounts_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  accounts_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  keys_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  keys_ms: number;

  @Column({ type: "smallint", nullable: true })
  keys_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  keys_errortype: HttpErrorType;
}
