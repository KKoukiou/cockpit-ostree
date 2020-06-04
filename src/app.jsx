/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import PropTypes from "prop-types";

import '../lib/patternfly/patternfly-4-cockpit.scss';

import { Title, Button, Alert, AlertActionCloseButton,
         EmptyState, EmptyStateVariant, EmptyStateIcon, EmptyStateBody,
         DataList, DataListItem, DataListItemRow, DataListItemCells, DataListCell, DataListContent, /* DataListAction, */
         Select, SelectOption,
         Page, PageSection, PageSectionVariants,
         Nav, NavList, NavItem, NavVariants,
         Modal,
         Form, FormGroup, ActionGroup,
         TextInput, TextArea,
         Checkbox,
         SimpleList, SimpleListItem
       } from '@patternfly/react-core';
import { ExclamationCircleIcon, OutlinedCheckCircleIcon, PencilAltIcon, AddCircleOIcon } from '@patternfly/react-icons';
import { Spinner,
         DataToolbar, DataToolbarItem, DataToolbarContent,
       } from '@patternfly/react-core/dist/esm/experimental';
import moment from 'moment';

import cockpit from 'cockpit';

import client from './client';
import * as remotes from './remotes';

import './ostree.scss';
import './form-layout.scss';

const _ = cockpit.gettext;

function track_id(item) {
    if (!item)
        return;

    var key = item.osname.v;
    if (item.id)
        key = key + item.id.v;

    if (item.checksum)
        key = key + item.checksum.v;

    return key;
}

/**
 * Empty state for connecting and errors
 */
const Curtain = ({ state, failure, message, reconnect }) => {
    if (state === 'silent')
        return null;

    let icon = null;
    if (state === 'connecting')
        icon = <Spinner size="xl" />;
    else if (failure)
        icon = <EmptyStateIcon icon={ExclamationCircleIcon} />;

    let title;
    if (state === 'connecting')
        title = _("Connecting to OSTree");
    else if (state === 'failed')
        title = _("Unable to communicate with OSTree");
    else if (state === 'empty')
        title = _("No Deployments");

    return (
        <EmptyState variant={EmptyStateVariant.full}>
            {icon}
            <Title headingLevel="h5" size="lg">{title}</Title>
            { message && <EmptyStateBody>{message}</EmptyStateBody> }
            { (state === 'failed' && reconnect) && <Button variant="primary">{ _("Reconnect") }</Button> }
        </EmptyState>
    );
};

Curtain.propTypes = {
    state: PropTypes.string.isRequired,
    failure: PropTypes.bool.isRequired,
    message: PropTypes.string,
    reconnect: PropTypes.bool,
};

const OriginSelector = ({ os, remotes, branches, branchLoadError, currentRemote, currentBranch, setChangeRemoteModal, onChangeBranch }) => {
    const [branchSelectExpanded, setBranchSelectExpanded] = useState(false);
    const [progressMsg, setProgressMsg] = useState(undefined);
    const [error, setError] = useState("");

    if (!os)
        return null;

    const checkForUpgrades = () => {
        setProgressMsg(_("Checking for updates"));

        return client.check_for_updates(os, currentRemote, currentBranch)
                .catch(ex => setError(ex.message))
                .finally(() => setProgressMsg(undefined));
    };

    const origin = client.get_default_origin(os);

    if (!origin || !remotes || remotes.length === 0)
        return <Alert variant="default" isInline title={ _("No configured remotes") } />;

    return (
        <>
            <DataToolbar id="repo-remote-toolbar">
                <DataToolbarContent>
                    <DataToolbarItem variant="label">{ _("Repository") }</DataToolbarItem>
                    <DataToolbarItem><Button id="change-repo" variant="link" onClick={() => setChangeRemoteModal(true)}>{currentRemote}</Button></DataToolbarItem>

                    <DataToolbarItem variant="label" id="branch-select-label">{ _("Branch")}</DataToolbarItem>
                    <DataToolbarItem>
                        <Select aria-label={ _("Select branch") } ariaLabelledBy="branch-select-label"
                                toggleId="change-branch"
                                isExpanded={branchSelectExpanded}
                                selections={currentBranch}
                                onToggle={exp => setBranchSelectExpanded(exp) }
                                onSelect={(event, branch) => { setBranchSelectExpanded(false); onChangeBranch(branch) } }>
                            { branchLoadError
                                ? [<SelectOption key="_error" isDisabled value={branchLoadError} />]
                                : (branches || []).map(branch => <SelectOption key={branch} value={branch} />)
                            }
                        </Select>
                    </DataToolbarItem>
                    <DataToolbarItem variant="separator" />
                    <DataToolbarItem>
                        <Button variant="secondary"
                                id="check-for-updates-btn"
                                isDisabled={!!client.local_running || !!progressMsg}
                                onClick={checkForUpgrades}>
                            {!(!!client.local_running || !!progressMsg) ? _("Check for Updates") : <Spinner size="sm" />}
                        </Button>
                    </DataToolbarItem>
                </DataToolbarContent>
            </DataToolbar>
            {branchLoadError && <Alert variant="warning" isInline title={branchLoadError} />}
            {error && <Alert className="upgrade-error" variant="warning" isInline title={error} />}
        </>
    );
};

OriginSelector.propTypes = {
    os: PropTypes.string,
    remotes: PropTypes.arrayOf(PropTypes.string),
    branches: PropTypes.arrayOf(PropTypes.string),
    branchLoadError: PropTypes.string,
    currentRemote: PropTypes.string,
    currentBranch: PropTypes.string,
    setChangeRemoteModal: PropTypes.func.isRequired,
    onChangeBranch: PropTypes.func.isRequired,
};

/**
 * Render a single deployment in the table
 */

const Packages = ({ packages }) => {
    if (!packages)
        return null;

    if (packages.empty)
        return <p>{ _("This deployment contains the same packages as your currently booted system") }</p>;

    var res = [];

    const render_list = (type, title) => {
        if (packages[type]) {
            /* rpms{1,2} have version/arch in name, and the version/arch fields are undefined */
            const f = packages[type].map(p => <dd key={ p.name }>{ p.version ? `${p.name}-${p.version}.${p.arch}` : p.name }</dd>);
            const isfullWidth = title ? " full-width" : "";
            res.push(
                <dl key={ "package-" + type} className={type + isfullWidth}>
                    {title && <dt>{title}</dt>}
                    {f}
                </dl>
            );
        }
    };

    render_list("adds", _("Additions"));
    render_list("removes", _("Removals"));
    render_list("up", _("Updates"));
    render_list("down", _("Downgrades"));
    render_list("rpms-col1");
    render_list("rpms-col2");
    return res;
};

Packages.propTypes = {
    packages: PropTypes.object,
};

const DeploymentVersion = ({ info, packages }) => {
    const [activeTabKey, setActiveTabKey] = useState('tree');
    const [inProgress, setInProgress] = useState(false);

    const doRollback = (osname) => {
        const args = {
            reboot: cockpit.variant("b", true)
        };
        setInProgress(true);
        return client.run_transaction("Rollback", [args], osname).finally(() => setInProgress(false));
    };

    const doUpgrade = (osname, checksum) => {
        const args = {
            reboot: cockpit.variant("b", true)
        };
        setInProgress(true);
        return client.run_transaction("Deploy", [checksum, args], osname).finally(() => setInProgress(false));
    };

    const doRebase = (osname, origin, checksum) => {
        const args = {
            reboot: cockpit.variant("b", true),
            revision: cockpit.variant("s", checksum),
        };
        setInProgress(true);
        return client.run_transaction("Rebase", [args, origin, []], osname).finally(() => setInProgress(false));
    };

    const isUpdate = () => {
        return client.item_matches(info, 'CachedUpdate') && !client.item_matches(info, 'DefaultDeployment');
    };

    const isRollback = () => {
        return !client.item_matches(info, 'CachedUpdate') && client.item_matches(info, 'RollbackDeployment');
    };

    const isRebase = () => {
        return !info.id && !client.item_matches(info, 'BootedDeployment', 'origin') && !client.item_matches(info, 'RollbackDeployment') &&
            !client.item_matches(info, "DefaultDeployment");
    };

    const id = track_id(info);
    let name = null;
    if (info && info.osname) {
        name = info.osname.v;
        if (info.version)
            name += " " + info.version.v;
    }

    let state;
    console.log({ info, client });
    if (inProgress)
        state = _("Updating");
    else if (info.booted && info.booted.v)
        state = <span><OutlinedCheckCircleIcon color="green" /> { _("Running") }</span>;
    else if (info.error)
        state = <span className="deployment-error"><ExclamationCircleIcon color="red" />{ _("Failed") }</span>;
    else
        state = _("Available");

    const treeTab = (
        <div className="ct-form">
            <label className="control-label" htmlFor="osname">{ _("Operating System") }</label> <div className="os" id="osname">{info.osname.v}</div>
            <label className="control-label" htmlFor="osversion">{ _("Version") }</label> <div className="version" id="osversion">{info.version.v}</div>
            <label className="control-label" htmlFor="osrelease">{ _("Released") }</label> <div className="timestamp" id="osrelease">{moment.unix(info.timestamp.v).fromNow()}</div>
            <label className="control-label" htmlFor="osorigin">{ _("Origin") }</label> <div className="origin" id="osorigin">{info.origin.v}</div>

        </div>);

    let signaturesTab;
    if (info.signatures && info.signatures.v.length > 0) {
        signaturesTab = [info.signatures.v.map((raw, index) => {
            const sig = client.signature_obj(raw);
            const when = new Date(sig.timestamp * 1000).toString();
            const validity = sig.valid ? _("Good Signature") : (sig.expired ? _("Expired Signature") : _("Invalid Signature"));
            return (
                <div className="ct-form .signatures" key={index}>
                    <label className="control-label" htmlFor="signature-signed-by">{ _("Signed by") }</label> <span id="signature-signed-by">{sig.by}</span>
                    <label className="control-label" htmlFor="signature-when">{ _("When") }</label> <span id="signature-when">{when}</span>
                    <label className="control-label" htmlFor="signature-name">{ sig.fp_name }</label> <span id="signature-name">{sig.fp}</span>
                    <label className="control-label" htmlFor="signature-valid">{ _("Validity") }</label> <span id="signature-valid">{validity}</span>
                </div>);
        })];
    } else {
        signaturesTab = <p>{ _("No signature available") }</p>;
    }

    return (
        <DataListItem aria-labelledby={id}>
            <DataListItemRow>
                <DataListItemCells dataListCells={[
                    <DataListCell key="name" width={4}> <span className="deployment-name" id={id}>{name}</span> </DataListCell>,
                    <DataListCell key="state" width={4}><span className="deployment-status">{state}</span></DataListCell>,
                    <DataListCell key="action" width={2}>
                        {isUpdate(info) && <Button variant="secondary"
                                                   onClick={() => doUpgrade(info.osname.v, info.checksum.v)}
                                                   isDisabled={!!client.local_running}>{_("Update Reboot")}</Button>}
                        {isRollback(info) && <Button variant="secondary"
                                                     onClick={() => doRollback(info.osname.v)}
                                                     isDisabled={!!client.local_running}>{_("Roll Back and Reboot")}</Button>}
                        {isRebase(info) && <Button variant="secondary"
                                                   onClick={() => doRebase(info.osname.v, info.origin.v, info.checksum.v)}
                                                   isDisabled={!!client.local_running}>{_("Rebase and Reboot")}</Button>}
                    </DataListCell>,
                ]} />
            </DataListItemRow>
            <DataListContent aria-label={cockpit.format("$0 Details", name)} id="available-deployments-expanded-content">
                <Nav onSelect={result => setActiveTabKey(result.itemId)}>
                    <NavList variant={NavVariants.tertiary}>
                        <NavItem isActive={activeTabKey === "tree"} itemId="tree">{ _("Tree") }</NavItem>
                        <NavItem isActive={activeTabKey === "packages"} itemId="packages">{ _("Packages") }</NavItem>
                        <NavItem isActive={activeTabKey === "signatures"} itemId="signatures">{ _("Signatures") }</NavItem>
                    </NavList>
                </Nav>
                <div className={'available-deployments-nav-content ' + activeTabKey}>
                    {activeTabKey === "tree" && treeTab}
                    {activeTabKey === "packages" && <Packages packages={packages} />}
                    {activeTabKey === "signatures" && signaturesTab}
                </div>
            </DataListContent>
        </DataListItem>
    );
};

DeploymentVersion.propTypes = {
    info: PropTypes.object.isRequired,
    packages: PropTypes.object,
};

const AddNewRepoForm = ({ setAddNewRepoDialogOpen, refreshRemotes }) => {
    const [newRepoName, setNewRepoName] = useState("");
    const [newRepoURL, setNewRepoURL] = useState("");
    const [newRepoTrusted, setNewRepoTrusted] = useState(false);

    const [hasValidation, setHasValidation] = useState(false);
    const [addNewRepoError, setAddNewRepoError] = useState(undefined);

    const onAddRemote = () => {
        if (!(newRepoURL.trim().length && newRepoName.trim().length)) {
            setHasValidation(true);
            return;
        }
        return remotes.addRemote(newRepoName, newRepoURL, newRepoTrusted)
                .then(() => refreshRemotes())
                .then(() => setAddNewRepoDialogOpen(false),
                      ex => setAddNewRepoError(ex.message));
    };

    return (
        <Form isHorizontal>
            <Title headingLevel="h3" size="l">
                {_("Add New Repository")}
            </Title>
            {addNewRepoError && <Alert variant="danger" isInline title={addNewRepoError} />}
            <FormGroup label={_("Name")}
                       fieldId="new-remote-name"
                       helperTextInvalid={_(_("Please provide a valid name"))}
                       validated={(hasValidation && !newRepoName.trim().length) ? "error" : undefined}
                       isRequired>
                <TextInput id="new-remote-name"
                           value={newRepoName}
                           isRequired
                           type="text"
                           onChange={name => setNewRepoName(name)} />
            </FormGroup>
            <FormGroup label={_("URL")}
                       fieldId="new-remote-url"
                       helperTextInvalid={_(_("Please provide a valid URL"))}
                       validated={(hasValidation && !newRepoURL.trim().length) ? "error" : undefined}
                       isRequired>
                <TextInput id="new-remote-url"
                           value={newRepoURL}
                           isRequired
                           type="text"
                           onChange={url => setNewRepoURL(url)} />
            </FormGroup>
            <FormGroup fieldId="new-gpg-verify">
                <Checkbox label={_("Use trusted GPG key")}
                          id="new-gpg-verify"
                          isChecked={newRepoTrusted}
                          onChange={(checked, ev) => {
                              setNewRepoTrusted(checked);
                          }} />
            </FormGroup>
            <ActionGroup>
                <Button id="add-remote-btn" onClick={() => onAddRemote()} variant="primary">{_("Add")}</Button>
                <Button onClick={() => setAddNewRepoDialogOpen(false)} variant="link">{_("Cancel")}</Button>
            </ActionGroup>
        </Form>
    );
};
AddNewRepoForm.propTypes = {
    refreshRemotes: PropTypes.func.isRequired,
    setAddNewRepoDialogOpen: PropTypes.func.isRequired,
};

const EditRemoteForm = ({ remoteSettings, setEditRepoDialogOpen, refreshRemotes }) => {
    const [addAnotherKey, setAddAnotherKey] = useState(false);
    const [key, setKey] = useState('');
    const [isTrusted, setIsTrusted] = useState(remoteSettings['gpg-verify'] !== 'false');
    const [error, setError] = useState('');

    const onUpdate = () => {
        const promises = [];
        if (key)
            promises.push(remotes.importGPGKey(remoteSettings.name, key));
        promises.push(remotes.updateRemoteSettings(remoteSettings.name, { "gpg-verify": isTrusted }));

        Promise.all(promises).then(() => setEditRepoDialogOpen(false), ex => setError(ex.message));
    };
    const onDelete = () => {
        remotes.deleteRemote(remoteSettings.name)
                .then(() => refreshRemotes())
                .then(setEditRepoDialogOpen(false), ex => setError(ex.message));
    };

    return (
        <Form isHorizontal>
            {error && <Alert variant="danger" isInline
                             action={<AlertActionCloseButton onClose={() => this.setState({ error: undefined })} />}
                             title={error} />}
            <Title headingLevel="h3" size="l">
                {remoteSettings.name}
            </Title>
            <FormGroup label={_("URL")}
                fieldId="edit-remote-url">
                <TextInput id="edit-remote-url"
                           value={remoteSettings.url}
                           readOnly
                           type="text" />
            </FormGroup>
            <FormGroup fieldId="edit-remote-trusted">
                <Checkbox label={_("Use trusted GPG key")}
                          id="gpg-verify"
                          isChecked={isTrusted}
                          onChange={(checked, ev) => {
                              setIsTrusted(!isTrusted);
                          }} />
            </FormGroup>
            <FormGroup fieldId="add-another-key">
                {!addAnotherKey ? <Button isInline variant="secondary" id='add-another-key' onClick={() => setAddAnotherKey(true)}>{_("Add Another Key")}</Button>
                 : <TextArea id='gpg-data'
                             placeholder="Begins with '-----BEGIN GPG PUBLIC KEY BLOCK-----'"
                             value={key} onChange={setKey} aria-label={_("GPG Public Key")} />}
            </FormGroup>
            <ActionGroup>
                <Button isInline variant="danger" className="delete-btn" onClick={onDelete}>{_("Delete")}</Button>
                <Button isInline variant="primary" className="apply-btn" onClick={onUpdate}>{_("Apply")}</Button>
                <Button isInline variant="link" onClick={() => setEditRepoDialogOpen(false)} className="cancel-btn">{_("Cancel")}</Button>
            </ActionGroup>
        </Form>
    );
};
EditRemoteForm.propTypes = {
    refreshRemotes: PropTypes.func.isRequired,
    setEditRepoDialogOpen: PropTypes.func.isRequired,
    remoteSettings: PropTypes.object.isRequired,
};

const ChangeRemoteModal = ({ setIsModalOpen, isModalOpen, remotesList, currentRemote, refreshRemotes, onChangeRemoteOrigin }) => {
    const [addNewRepoDialogOpen, setAddNewRepoDialogOpen] = useState(false);
    const [editRepoDialogOpen, setEditRepoDialogOpen] = useState(false);
    const [selectedRemote, setSelectedRemote] = useState(currentRemote);
    const [error, setError] = useState("");

    const footer = <>
        <Button key="change-repo"
                variant="primary"
                isDisabled={!!editRepoDialogOpen}
                onClick={() => {
            onChangeRemoteOrigin(selectedRemote).then(() => setIsModalOpen(false), ex => setError(ex.message));
        }}>
            {_("Change Repository")}
        </Button>
        <Button key="cancel" variant="link" onClick={() => setIsModalOpen(false)}>
            {_("Cancel")}
        </Button>
    </>;

    return (
        <Modal title={_("Change Repository")}
               width='50%'
               appendTo={document.body}
               isOpen={isModalOpen}
               onClose={() => setIsModalOpen(false)}
               isFooterLeftAligned
               footer={footer}>
            <>
                {error && <Alert variant="danger" isInline title={error} />}
                <SimpleList className="remote-select" onSelect={(_, currentItemProps) => { console.log('setSelectedRemote', currentItemProps.id); setSelectedRemote(currentItemProps.id) }}>
                    {(remotesList || []).map(remote => {
                        return (
                            (!editRepoDialogOpen || editRepoDialogOpen.name !== remote)
                            ? <SimpleListItem key={remote}
                                              id={remote}
                                              component="a"
                                              onClick={ev => {
                                                  ev.stopPropagation();
                                                  ev.preventDefault();
                                              }}
                                              isCurrent={remote === selectedRemote}>
                                <span>{remote}</span>
                                <Button onClick={ ev => {
                                            remotes.loadRemoteSettings(remote)
                                                .then(remoteSettings => setEditRepoDialogOpen(Object.assign(remoteSettings, { name: remote })));
                                        }}
                                        className="edit-remote"
                                        variant="secondary">
                                    <PencilAltIcon />
                                </Button>
                            </SimpleListItem>
                            : <div key={remote} className="pf-c-simple-list__item-link">
                                <EditRemoteForm setEditRepoDialogOpen={setEditRepoDialogOpen} remoteSettings={editRepoDialogOpen} refreshRemotes={refreshRemotes} />
                            </div>
                        );
                    }).concat([
                        !addNewRepoDialogOpen
                        ? <SimpleListItem component="a"
                                        onClick={ev => {
                                            ev.stopPropagation();
                                            ev.preventDefault();
                                        }}
                                        key="add-new">
                            <Button onClick={ev => {
                                ev.stopPropagation();
                                ev.preventDefault();
                                setAddNewRepoDialogOpen(true);
                            }}
                                   variant="link"
                                   icon={<AddCircleOIcon />}
                                   id="add-new-remote-btn"
                                   iconPosition="left">{_("Add New Repository")}</Button>
                        </SimpleListItem>
                        : <div key="add new" className="pf-c-simple-list__item-link">
                            <AddNewRepoForm refreshRemotes={refreshRemotes} setAddNewRepoDialogOpen={setAddNewRepoDialogOpen} />
                        </div>
                    ])}
                </SimpleList>
            </>
        </Modal>
    );
};
ChangeRemoteModal.propTypes = {
    remotesList: PropTypes.array.isRequired,
    currentRemote: PropTypes.string.isRequired,
    isModalOpen: PropTypes.bool.isRequired,
    setIsModalOpen: PropTypes.func.isRequired,
    refreshRemotes: PropTypes.func.isRequired,
    onChangeRemoteOrigin: PropTypes.func.isRequired,
};

/**
 * Main application
 */
class Application extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            os: null,
            remotes: null,
            branches: null,
            branchLoadError: null,
            origin: { remote: null, branch: null },
            curtain: { state: 'silent', failure: false, message: null, final: false },
            runningMethod: null, /* operation in progress, disables actions */
            showChangeRemoteDialog: null,
            isChangeRemoteOriginModalOpen: false,
        };

        this.onChangeBranch = this.onChangeBranch.bind(this);
        this.onChangeRemoteOrigin = this.onChangeRemoteOrigin.bind(this);
        this.refreshRemotes = this.refreshRemotes.bind(this);

        /* show "connecting" curtain if connecting to client takes longer than 1s */
        let timeout;
        timeout = window.setTimeout(() => {
            this.setState({ curtain: { state: 'connecting', failure: false, message: null } });
            timeout = null;
        }, 1000);

        const check_empty = () => {
            window.clearTimeout(timeout);
            timeout = null;
            if (client.os_list && client.os_list.length === 0) {
                this.setState({ curtain: { state: 'empty', failure: true, message: _("No OSTree deployments found"), final: true } });
            } else {
                let newState;
                if (!this.state.origin.remote) {
                    const os = client.os_list[0];
                    const origin = client.get_default_origin(os) || {};
                    newState = {
                        curtain: { state: null },
                        os,
                        origin: { remote: origin.remote, branch: origin.branch },
                    };
                    this.setState(newState);
                }
                this.updateBranches(this.state.origin.remote || newState.origin.remote);
            }
        };

        const show_failure = ex => {
            let message = null;
            let final = false;

            if (ex.problem === "access-denied") {
                message = _("Not authorized to update software on this system");
            } else if (ex.problem === "not-found") {
                message = _("OSTree is not available on this system");
                final = true;
            } else {
                message = cockpit.message(ex);
            }

            this.setState({ curtain: { state: 'failed', failure: true, message, final } });
        };

        client.addEventListener("connectionLost", (event, ex) => show_failure(ex));
        client.addEventListener("changed", () => { console.log('changed event received'); this.forceUpdate() });

        client.connect()
            .then(() => { timeout = window.setTimeout(check_empty, 1000) })
            .fail(ex => {
                window.clearTimeout(timeout);
                show_failure(ex);
            });

        this.refreshRemotes();
    }

    onChangeRemoteOrigin(remote) {
        this.setState(prevState => ({
            origin: {
                ...prevState.origin,
                remote: remote,
            }
        }));
        return this.updateBranches(remote).then(() => {
            client.cache_update_for(this.state.os, remote, this.state.origin.branch);
        });
    }

    refreshRemotes() {
        remotes.listRemotes()
            .then(remotes => this.setState({ remotes }))
            .catch(ex => {
                console.warn(ex);
                this.setState({
                    remotes: null,
                    branches: null,
                    curtain: { state: 'failed', failure: true, final: true, message: cockpit.format(_("Error loading remotes: $0"), cockpit.message(ex)) }
                });
            });
    }

    onChangeBranch(branch) {
        console.log("XXX onChangeBranch", this.state.os, this.state.origin.remote, branch);
        this.setState(prevState => ({
            origin: {
                ...prevState.origin,
                branch: branch,
            }
        }));
        return client.cache_update_for(this.state.os, this.state.origin.remote, branch);
    }

    updateBranches(remote) {
        console.info('updateBranches', remote);
        if (!remote) {
            console.log("XXX updateBranches(): no current remote");
            return;
        }

        return remotes.listBranches(remote)
            .then(branches => {
                console.log({ branches });
                const update = { branches, branchLoadError: null };
                // if current branch does not exist, change to the first listed branch
                if (branches.indexOf(this.state.origin.branch) < 0)
                    update.origin = { remote: this.state.origin.remote, branch: branches[0] };
                this.setState(update);
            })
            .catch(ex => {
                this.setState({
                    branches: null,
                    branchLoadError: cockpit.message(ex)
                });
            });
    }

    render() {
        console.log("XXX Application state TEST:", JSON.stringify(this.state));
        console.log('render 1');
        /* curtain: empty state pattern (connecting, errors) */
        const c = this.state.curtain;
        if (c.state)
            return <Curtain state={c.state} failure={c.failure} message={c.message} reconnect={!c.final} />;

        /* TODO: support more than one OS */

        /* successful, deployments are available */
        const items = client.known_versions_for(this.state.os, this.state.origin.remote, this.state.origin.branch)
                          .map(item => {
                              const packages = client.packages(item);
                              if (packages)
                                  packages.addEventListener("changed", () => this.setState({})); // re-render
                              return <DeploymentVersion key={ track_id(item) } info={item} packages={packages} />;
                          });
        console.log('render', items);
        return (
            <Page>
                <ChangeRemoteModal isModalOpen={this.state.isChangeRemoteOriginModalOpen}
                                   setIsModalOpen={isChangeRemoteOriginModalOpen => this.setState({ isChangeRemoteOriginModalOpen })}
                                   currentRemote={this.state.origin.remote}
                                   refreshRemotes={this.refreshRemotes}
                                   onChangeRemoteOrigin={this.onChangeRemoteOrigin}
                                   remotesList={this.state.remotes} />
                <PageSection variant={PageSectionVariants.light} type='nav'>
                    <OriginSelector os={this.state.os} remotes={this.state.remotes}
                                    branches={this.state.branches} branchLoadError={this.state.branchLoadError}
                                    currentRemote={this.state.origin.remote} currentBranch={this.state.origin.branch}
                                    setChangeRemoteModal={isChangeRemoteOriginModalOpen => this.setState({ isChangeRemoteOriginModalOpen })} onChangeBranch={this.onChangeBranch} />
                </PageSection>
                <PageSection>

                    {this.state.error && <Alert variant="danger" isInline title={this.state.error} />}
                    <DataList className="available-deployments" aria-label={ _("available deployments") }>{items}</DataList>
                </PageSection>
            </Page>
        );
    }
}

document.addEventListener("DOMContentLoaded", function () {
    ReactDOM.render(React.createElement(Application, {}), document.getElementById('app'));
});
